# Superpowers v6 integration + an efficiency pass

**Date:** 2026-06-16
**Relates:** Superpowers v6 (dev branch `08fc48c`, version `6.0.0`, unreleased). ultrapowers pairs
with Superpowers at the "execute the plan" step; v6 changes both the plan artifact ultrapowers
consumes and the orchestration patterns ultrapowers mirrors. Also relates to the verification-first
thesis (every self-claim checked by something the system cannot edit) and to the known dominant
run cost (per-worktree re-bootstrap + redundant suite runs).

## Context

Superpowers v6 reports "roughly twice as fast / ~50% fewer tokens" in its own evals. The gains
come from a small set of named mechanisms, all living in the `subagent-driven-development` (SDD)
skill plus its design specs: a **unified single reviewer** (the v5 spec-reviewer + code-quality-
reviewer pair, merged into one pass returning two verdicts plus a new `⚠️ cannot-verify-from-diff`
channel); **pre-baked review packets** (a `review-package` script writes commits + `git diff -U10`
to a file the reviewer reads once, instead of the reviewer running live git — measured to take one
reviewer from 33 turns to 6); **conditional implementer tiering** under the doctrine "cheapen
mechanics, never judgment" (measured: a cheap controller shipped planted defects 4/5 runs, a cheap
reviewer caught 0/10); **terse reviewer/implementer contracts**; and a **model/harness-agnostic**
skill rewrite that names *actions* ("dispatch a subagent") rather than tool names.

The plan artifact itself changed only additively. v6 adds two blocks and one authoring rule to
`writing-plans`:

- `## Global Constraints` in the plan header — project-wide requirements (version floors, naming/
  copy rules, platform reqs) copied verbatim from the spec; "every task's requirements implicitly
  include this section."
- `**Interfaces:**` per task (after `**Files:**`) — `Consumes:` (signatures used from earlier
  tasks) and `Produces:` (function names, param/return types later tasks rely on). "A task's
  implementer sees only their own task; this block is how they learn the names and types
  neighboring tasks use."
- `## Task Right-Sizing` — authoring guidance only; no on-disk format change.

ultrapowers' sole plan parser is `skills/ultrapowers/scripts/compile_plan.py`. It keys on
`### Task <id>:` (`TASK_HEAD`), `**Files:**` with `- Create:/Modify:/Test:` (`FILE_LINE`), the
ultrapowers-only markers `**Type:**`/`**Depends-on:**`/`**Acceptance:**`, prose text-deps, and a
fence-aware line scanner. All three of those v6 shapes (`### Task N:`, `**Files:**`, `- [ ]`) are
byte-identical to v5.1.0, so **a v6 plan already compiles** — but the two new blocks are silently
ignored, and the compat tripwire (`tests/test_superpowers_compat.py`) attests against installed
5.1.0.

## Problem

The user bundles two problems into one plan:

1. **ultrapowers does not yet speak v6.** It attests to 5.1.0 and drops v6's two new plan signals
   on the floor. Those signals are not incidental: worktree isolation means an implementer cannot
   see sibling tasks, which is precisely the blindness `Interfaces` was invented upstream to cure,
   and `Interfaces: Consumes` is a second, explicit dependency signal that would catch the
   undeclared-dependency class the eval's own `flawed` fixture is built around (Task 4 uses Task 1's
   `schema.User` but declares `Depends-on: none`).

2. **ultrapowers leaves measured efficiency on the table.** Its per-task reviewers run live git
   (`git checkout --detach <HEAD>; git diff BASE...HEAD`) at the always-opus tier rather than
   reading a pre-baked diff; fresh worktrees re-run `bootstrapCmd` (dep install) per worktree per
   task per fix-round and the baseline suite runs at setup + every wave merge + every implementer
   cycle + every reviewer + the completeness critic (the dominant cost); and the baked prompts are
   verbose relative to v6's measured-terse contracts.

**Decisions taken** (from brainstorming): migrate to v6 and drop v5 as a *support stance* (parser
stays additive-tolerant; no active rejection of v5 plans while v6 is unreleased); validate now
against a vendored v6 snapshot and flip the attestation to the installed cache when v6 reaches GA;
take the maximal Part-1 ambition (consume the blocks **and** strengthen the DAG); take all four
efficiency levers; specify the measurement protocol and wire cheap micro-tests now, with the full
45-cell eval matrix as a follow-up (Fable is suspended regardless).

## Design

### Part 1 — v6 integration

#### 1.1 Vendored v6 snapshot + re-attestation (foundational; land first)

v6 is unreleased, so there is no installed cache to attest against. Freeze a pinned snapshot of the
v6 handoff surface into `tests/fixtures/superpowers-v6/` — the files `test_superpowers_compat.py`
reads contract tokens from: `writing-plans/SKILL.md`, `subagent-driven-development/SKILL.md` and its
`implementer-prompt.md` / `task-reviewer-prompt.md` / `scripts/{task-brief,review-package}`,
`requesting-code-review/code-reviewer.md`, `receiving-code-review/SKILL.md`. Record the source
commit (`08fc48c`) in a `PROVENANCE` note beside the fixture.

Rework `test_superpowers_compat.py` so its source-of-truth is a single function with a clearly
marked **GA-flip seam**: today it returns the vendored snapshot path; when v6 publishes, one edit
points it back at the installed plugin cache and bumps the attested version. The token assertions
update from the v5 set to the v6 set (the unified `task-reviewer` replaces the deleted
`spec-reviewer-prompt.md` / `code-quality-reviewer-prompt.md`; add the `## Global Constraints` and
`**Interfaces:**` tokens). The parser stays additive-tolerant: a v5 plan (no new blocks) still
compiles, so current users are not bricked before GA.

Update the attestation line in `skills/ultrapowers/SKILL.md` and the "validated against 5.1.0"
claims in `README.md` to name the vendored v6 snapshot and its commit. Realign any prose that
references the deleted v5 two-reviewer fallback to the v6 unified `task-reviewer`.

#### 1.2 Teach `compile_plan.py` the new blocks

- **Global Constraints:** recognize a top-level `## Global Constraints` section in the plan header;
  capture its body verbatim as `plan.global_constraints`. Emit it in the compiler output JSON.
- **Interfaces:** recognize a per-task `**Interfaces:**` block (opens on `**Interfaces:**`, after
  the `**Files:**` block, before the first `- [ ]` step) with `- Consumes:` / `- Produces:`
  sub-lines; capture as `task.interfaces = {consumes: [...], produces: [...]}`. The `**Files:**`
  parser must **stop cleanly** at `**Interfaces:**` and must not treat `- Consumes:`/`- Produces:`
  as malformed file lines or conflicts (today any non-`Create/Modify/Test` `-` line in the Files
  block is surfaced as a near-miss conflict — the Interfaces block must be exempt). Stay fence-aware
  (reuse `_fence_aware_lines()`), so Interfaces examples inside code fences are inert.

Both blocks are **optional**: their absence is the v5 case and must not warn.

#### 1.3 Strengthen the DAG with Interfaces — *judgment call #1*

When Task B's `Consumes` names a symbol Task A's `Produces` exposes, B depends on A — even if B's
`**Depends-on:**` omits it. Implementation, kept conservative because the compiler is deterministic
and pinned by `test_compile_plan.py`:

- **Matching is exact-token, not fuzzy.** Normalize each `Consumes`/`Produces` entry to its symbol
  token(s) and match by exact string equality. No substring/fuzzy matching — a false edge would
  silently re-order waves. When in doubt, add no edge.
- **An Interfaces-derived edge is a real edge** (it joins file-overlap, `Depends-on`, and text-dep
  edges in the Kahn layering). This is what reorders the `flawed` fixture so Task 4 lands in a wave
  after Task 1.
- **Every Interfaces-implied edge not already covered by `Depends-on` or file-overlap is surfaced
  as a loud "undeclared dependency" finding** in the compile report (same channel as near-miss
  conflicts). The plan still compiles and runs correctly, *and* the author is told their
  `Depends-on` was wrong — fix-at-authoring, not silent repair.
- A Consumes with no matching Produces anywhere is **not** an error (it may name an external/
  pre-existing symbol); optionally note it as advisory.

The `flawed` eval fixture becomes the regression test: it must now compile with Task 4 dependent on
Task 1 and emit the undeclared-dependency finding.

#### 1.4 Forward Global Constraints + Interfaces into the baked prompts

The signals are useless unless they reach the agents:

- **Implementer prompt** gains the task's `Interfaces` (so the isolated implementer knows the exact
  neighboring signatures it consumes and the contract it must produce) and the plan's Global
  Constraints (binding requirements). New `{{INTERFACES}}` and `{{GLOBAL_CONSTRAINTS}}` placeholders.
- **Reviewer prompt** gains Global Constraints as the "attention lens" (v6's exact pattern — copy
  the binding requirements verbatim so the reviewer gates against what the spec demands) and the
  task's Interfaces (so a per-task reviewer can check the produced contract matches what neighbors
  consume).

Authored in the reference files (`references/*.md`), then re-baked verbatim into `waves.js` (see
Re-bake discipline).

#### 1.5 ultraplan authoring update

`skills/ultraplan/SKILL.md` instructs plan authors to populate the v6 blocks and tells them the
blocks are now **load-bearing in ultrapowers**, not just documentation: `Consumes`/`Produces` are
cross-checked against `Depends-on` (an omission becomes an "undeclared dependency" finding), and
Global Constraints are forwarded to every reviewer as its attention lens. Marker placement is
unchanged — `**Type:**`/`**Depends-on:**` stay in the contiguous header block immediately after the
`### Task N:` heading and before `**Files:**`; `**Interfaces:**` sits after `**Files:**`. Keep the
ultraplan↔`plan-markers.md` anti-drift pin intact.

### Part 2 — efficiency

#### 2.1 Pre-baked review packets — *judgment call #2*

Adopt v6's `review-package` (commits + `git diff --stat` + `git diff -U10` → one file) but adapt
its storage to ultrapowers' reality: the implementer and reviewer run in **different** worktrees, so
v6's per-worktree git-dir path (`git rev-parse --git-path sdd`) is not shared between them. Write the
packet to the **shared common git dir** instead — `git rev-parse --git-common-dir`, which resolves
to the same location for every linked worktree of the repo — under e.g. `ultra/review-<base>..<head>.diff`.

- The **implementer's final step** generates the packet for its recorded `BASE...HEAD`. This shifts
  the git work off the always-opus reviewer onto the often-cheaper-tier implementer — a cost win on
  top of the turn-count win.
- The **reviewer prompt** changes from "detach + `git diff` yourself" to "read the pre-baked packet
  at `<path>`; do not run git," with a **guarded fallback**: if the packet is missing or its
  recorded HEAD ≠ the implementer HEAD, the reviewer falls back to the current live-git path (so a
  miss degrades to status quo, never to an unreviewed task).
- On a fix-loop re-dispatch the implementer regenerates the packet for the new HEAD, so the reviewer
  always reads the diff it is grading. Review stays anchored to the task's exact integration `BASE`,
  not main.

#### 2.2 cannot-verify-from-diff channel → completeness critic

Add the third reviewer verdict, `⚠️ cannot-verify-from-diff`, for requirements that span tasks or
live in unchanged code — exactly the class a per-task, worktree-isolated reviewer structurally
cannot judge. Rather than let the reviewer crawl the repo to chase them (the v5 cost sink), the
reviewer **lists** them and the engine **routes** them to the completeness critic, which already
runs at opus on the integrated tree with the original plan in hand — the one role that can verify
cross-task claims. Carry the items through the reviewer report schema; the completeness-critic
prompt consumes them as an explicit checklist. (`lean` already merges spec+quality into one pass;
this adds the escalation channel both `lean` and `adversarial` emit.)

#### 2.3 Worktree bootstrap/test caching — *judgment call #3* (highest effort/reward)

The dominant cost. Two sub-levers:

- **(a) Warm-cache the dependency install.** Today every fresh worktree re-runs `bootstrapCmd`
  (`pip install -e .`, `bun install`, …) — per worktree, per task, per fix-round. Instead, bootstrap
  the dependency tree **once** into a warm cache (keyed by the lockfile hash; stored under the shared
  common git dir or `${CLAUDE_PLUGIN_DATA}` so it survives plugin updates), and each implementer's
  bootstrap **hardlink-clones** it into place (`cp -al node_modules` / reuse the prebuilt `.venv`)
  — near-instant — falling back to a real install on a cache miss or lockfile change. The engine has
  no shell, so this lives in the bootstrap step of the baked implementer prompt plus a small helper
  script the agent invokes; it stays generic via the existing `bootstrapCmd` abstraction.
- **(b) Cut the reviewer's full-suite run.** With a pre-baked diff (2.1) and the implementer's
  proven RED→GREEN evidence, the opus reviewer should **read, not re-test**: drop the reviewer's
  baseline-suite invocation. The suite still runs where it is load-bearing — the TDD red/green cycle
  inside the implementer, every wave-merge gate, reconcile, and the completeness critic on the
  integrated tree. Removing one full-suite run per reviewer per task (×1, or ×2 under `adversarial`)
  is a direct, safe reduction.

This is the most engine-invasive change and the one most coupled to the eval re-run; treat it as its
own track.

#### 2.4 Terse contracts + micro-test loop

- Tighten the baked reviewer and implementer prompts to v6's measured contracts: the reviewer's
  final message **is** the report (no preamble/process-narration/closing summary), every line a
  verdict or a finding with `file:line` evidence; the implementer's back-channel is capped (~≤15
  lines) with the detail in its report file. Apply v6's measured phrasing rule — **positive recipe,
  not prohibition** — when an instruction governs output shape (prohibitions on composition measured
  *worse* than no guidance).
- Add a cheap micro-test harness (a `run-micro.py`-style one-API-call-per-sample loop with
  programmatic scoring and an always-present no-guidance control) under `evals/` for tuning these
  prompts before spending on full runs.

#### 2.5 Measurement protocol (specify + wire cheap now; full matrix later)

Re-freeze the engine (bump `0.0.x`); record that the 45-cell A/B/C matrix must be re-run on the new
frozen version and never pooled across versions (per `report.py`'s partition-by-`plugin_version`
rule). Wire the micro-test loop (2.4) and keep `scripts/audit_run.py`'s per-role turn/output-token
proxies. Document the per-component cost-attribution table (controller / implementers / reviewers /
final review) as the model for finding ultrapowers' own hot spots. Running the full matrix and any
Fable-placement work are explicit follow-ups.

### Sequencing

1. **First:** 1.1 (vendored snapshot + re-attestation) — unblocks everything and pins the v6 contract.
2. **Coordinated re-bake set** (all touch `waves.js` baked prompts; do together so BAKE blocks and
   `test_no_prompt_drift.py` change once): 1.4 (forward signals) + 2.1 (packets) + 2.2 (cannot-verify)
   + 2.4 (terse contracts).
3. **Parallel track A:** 1.2 + 1.3 (`compile_plan.py` parsing + DAG) — independent of the prompt set.
4. **Parallel track B:** 2.3 (caching) — most isolated engine change.
5. 1.5 (ultraplan) rides with track A (shares the marker/Interfaces contract). 2.5 (measurement) lands last.

### Folded-in cleanups (surfaced during analysis)

- README path drift: references to `skills/ultrapowers/workflow.js` should read
  `skills/ultrapowers/harnesses/waves.js` (README and the stale header comment at `waves.js:1`).
- `Delete:` label inconsistency: README/compat prose mention a `Delete:` file label, but `FILE_LINE`
  only recognizes `Create|Modify|Test`. Reconcile (either implement `Delete:` or drop the mention).

## Components touched

| File | Change |
|---|---|
| `tests/fixtures/superpowers-v6/**` (new) | Pinned v6 handoff snapshot + `PROVENANCE` (commit `08fc48c`). |
| `tests/test_superpowers_compat.py` | Source-of-truth function with GA-flip seam; v5→v6 contract tokens; assert new blocks. |
| `skills/ultrapowers/scripts/compile_plan.py` | Parse `## Global Constraints` + per-task `**Interfaces:**`; Files-parser exemption; Interfaces→DAG edges (exact-match) + undeclared-dependency findings; emit both in output JSON. |
| `skills/ultrapowers/references/dependency-analysis.md` | Document Interfaces as an edge source + the undeclared-dependency finding. |
| `skills/ultrapowers/references/reviewer-prompts.md` | Reviewer prompt: read pre-baked packet (guarded fallback), Global Constraints attention-lens, Interfaces, `⚠️ cannot-verify-from-diff` channel, terse contract; drop reviewer suite run. Tier-selection wording sharpened. |
| `skills/ultrapowers/references/implementer-prompt(s)` | Implementer: `{{INTERFACES}}` + `{{GLOBAL_CONSTRAINTS}}`; final-step packet generation; warm-cache bootstrap; ≤15-line back-channel. |
| `skills/ultrapowers/references/wave-merge.md` | Completeness critic consumes the cannot-verify checklist. |
| `skills/ultrapowers/references/report-format.md` | Carry cannot-verify items + undeclared-dependency findings; note packet path. |
| `skills/ultrapowers/scripts/review-package` (new) | Adapted v6 packet generator writing to the shared common git dir. |
| `skills/ultrapowers/scripts/warm_cache.sh` (new) | Lockfile-keyed warm dependency cache + hardlink-clone helper. |
| `skills/ultrapowers/harnesses/waves.js` | Thread Global Constraints/Interfaces/packet-path/cannot-verify through dispatch; re-bake every changed prompt verbatim; cut reviewer suite run; wire packet + warm-cache steps. |
| `skills/ultrapowers/SKILL.md` | Attestation → v6 snapshot; reflect new signals + efficiency steps. |
| `skills/ultraplan/SKILL.md` | Author guidance for Global Constraints + Interfaces (load-bearing); keep marker placement + anti-drift pin. |
| `README.md` | v6 attestation; `workflow.js`→`harnesses/waves.js`; `Delete:` reconcile. |
| `evals/scripts/run-micro.py` (new) + `evals/README.md` | Micro-test loop; re-freeze + per-component cost-attribution protocol. |
| `tests/test_compile_plan.py`, `tests/test_marker_compiler.py`, `tests/sim_workflow.mjs`, `tests/test_no_prompt_drift.py`, `evals/fixtures/flawed*` | New parsing/DAG/finding assertions; dispatched-prompt assertions; drift pins; `flawed`-fixture regression. |

## Re-bake discipline

Every prompt edit lands in its `references/*.md` source first, then verbatim into `waves.js`;
`tests/test_no_prompt_drift.py` asserts the two stay in sync (static fragments in order around
`{{PLACEHOLDER}}` tokens). New placeholders (`{{GLOBAL_CONSTRAINTS}}`, `{{INTERFACES}}`,
`{{REVIEW_PACKET_PATH}}`) follow the existing fragment-split pattern. The coordinated re-bake set
(1.4/2.1/2.2/2.4) is sequenced together precisely so the GUARD/REVIEWER/IMPLEMENTER/COMPLETENESS
baked copies change once.

## Error handling

- **Missing/stale review packet** → reviewer falls back to live `git diff` (status quo); never an
  unreviewed task.
- **Warm-cache miss or lockfile change** → real `bootstrapCmd` install; correctness never depends on
  the cache.
- **Interfaces exact-match ambiguity** → add no edge (conservative); a genuine cross-task dep that
  also overlaps writes is still caught by file-overlap inference.
- **cannot-verify items with no completeness critic** (engine couldn't record a merge HEAD) → the
  items surface as judgment calls at the gate rather than being dropped.
- **v6 GA mismatch** → when the flip points at the installed cache, any drift between the vendored
  snapshot and shipped v6 fails `test_superpowers_compat.py` loudly (the intended tripwire).

## Testing

- `python3 -m pytest tests/ -q` green; `compile_plan.py` parsing/DAG covered by
  `test_compile_plan.py` (new Interfaces/Global-Constraints/undeclared-dep cases) and the `flawed`
  fixture regression.
- `tests/sim_workflow.mjs` asserts the dispatched implementer/reviewer prompts carry Global
  Constraints, Interfaces, the packet path, and the cannot-verify channel, and that the reviewer no
  longer runs the suite.
- `tests/test_no_prompt_drift.py` keeps every re-baked copy honest.
- `tests/test_superpowers_compat.py` passes against the vendored v6 snapshot.
- `validate_skill.py` prints `skill ok` for the touched skills.
- Efficiency gains are measured by the micro-test loop now; the full 45-cell matrix on the re-frozen
  engine is a follow-up, not a gate for this plan.

## Acceptance disposition

**`**Acceptance:** suite`** — this is a change to ultrapowers' own orchestration/verification
machinery and its plan compiler, verified by its committed suite plus the drift/sim guards and the
`flawed`-fixture regression. No held-out sealed exam (there is no end-user feature spec to author an
independent exam from; the subject *is* the verification machinery).

## Non-goals

- Running the full 45-cell eval matrix or any Fable-placement experiment (follow-ups; Fable
  suspended).
- Active rejection of v5-format plans (the parser stays additive-tolerant until v6 GA; "drop v5" is
  a support/attestation stance, not a runtime gate).
- A full multi-harness (Codex/Gemini/Copilot) tool-name abstraction — ultrapowers is a Claude-Code
  Workflow executor; adopt v6's *action-naming discipline* in prose, not the per-harness mapping
  files.
- OS-level sandboxing of read-only roles — enforcement stays policy-by-prompt + the deterministic
  gate check, per the existing harness-library boundary.
- ultradocket changes — it parses its own `docket.md`, not Superpowers plans, and is outside the
  compatibility surface.
