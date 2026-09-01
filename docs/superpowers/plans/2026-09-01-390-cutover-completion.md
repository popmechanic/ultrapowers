# The #390 Cutover Completion — run-44 Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the #390 cutover parked at run-43 (PR #520 merged its Tasks 1/3/4):
land the claims-v1 edge derivation, the `ultrawrite` skill, the deletions, and the doc
wording — with run-43's two plan defects corrected and its two review residues fixed.

**Architecture:** Base already contains the claims-v1 slot parser (`plan_grammar`,
`parse_claims_body`), the gate-verdict machinery, and `check_provenance.py`. This plan
adds the edge tier work to the claims-v1 branch of `compile_plan.py`, corrects the
run-43 contradiction (the legacy `undeclared-dependency` cross-check is RETIRED under
claims-v1 — its remedy is unsayable there), authors the skill with the marker layout
pinned to what the compiler actually parses, then deletes ultraplan and re-points every
coupling.

**Tech Stack:** Python 3 (stdlib only — no `anthropic` SDK, no API keys), pytest.

**Spec:** `docs/superpowers/specs/2026-08-31-owned-authoring-skill.md`

## Global Constraints

- No direct Anthropic API calls and no `anthropic` SDK in any shipped or dev script.
- All new compiler diagnostics carry the `grammar:` prefix; every pre-existing
  diagnostic string in `compile_plan.py` is byte-identical after this plan, with ONE
  licensed exception: under claims-v1 (and only there) the `undeclared-dependency`
  conflict is not emitted (spec §3 edge-tier table, amended after run-43).
- Legacy fixture corpus behavior is pinned: compiling `evals/fixtures/wide` and
  `evals/fixtures/chained` produces output identical to pre-plan output.
- No word-count check may refuse: word counts appear only as `ADVISORY` lines (spec §1.5).
- The full suite (`python3 -m pytest`) passes at the end of every task.
- `fleet/` is untouched by this plan.

**Acceptance:** suite — the committed suite is the verification.

---

### Task 1: claims-v1 edge derivation, advisories, and the retired cross-check

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Test: `tests/test_compile_plan_claims_edges.py`

**Interfaces:**
- Consumes: `plan_grammar(md_text: str) -> str`, `parse_claims_body(body: str, task_id: str) -> dict` (at BASE since PR #520)
- Produces: nothing new — edge output uses the existing edge/`why` structures

- [ ] **Step 1: Write failing tests** in `tests/test_compile_plan_claims_edges.py`,
  against `evals/fixtures/claims/plan.md` plus inline variants (every claims-v1 compile
  in these tests needs a fresh gate-verdicts file — build it the way
  `tests/test_gate_verdicts.py` does at BASE):
  - Interface edge: fixture Task 2 Consumes what Task 1 Produces → edge 1→2 with the
    existing `interface` why-label; no `marker` edges exist anywhere under claims-v1.
  - **The retired cross-check (the run-43 correction):** compiling the claims fixture
    leaves `marker_conflicts` EMPTY — no `undeclared-dependency` entry for any
    interface edge. In `build_edges` the legacy tier computes
    `declared = a["id"] in b["depends_on"]`, always False under claims-v1 (the grammar
    zeroes `depends_on`), so without this suppression the canonical happy path emits a
    loud conflict telling the author to add a marker the grammar refuses. Also assert a
    LEGACY plan still emits `undeclared-dependency` exactly as before (pin one case).
  - Text tier off: a Context slot containing `after Task 1 completes` produces NO edge,
    and `--check` output contains a line starting
    `ADVISORY grammar: ordering phrasing in a body slot never orders`.
  - Unmatched Consumes: a Consumes naming a symbol no sibling Produces draws
    `ADVISORY grammar: Consumes pairs with no sibling Produces` — for both a free-prose
    value and a typo'd symbol; placeholder values (`none`, `nothing`) draw nothing.
  - Context word count: every claims task draws
    `ADVISORY grammar: Context is N words` with the correct N; nothing refuses at any N.
  - Non-text same-file: two tasks whose `Files:` both name a path assets/logo.png —
    when the compile is given a tree root where that path is binary (write bytes
    `\x89PNG\x00` to that path under the test's own tmp_path and pass the root the way
    `--renders` receives BASE), an edge with why-label `non-text-overlap` orders them;
    with no tree root the pair draws
    `ADVISORY grammar: same-file pair not classifiable without a tree`.
  - **The half-threaded seam (run-43 Task-1 residue):** `render_advisories()`'s
    re-parse (`tasks = [parse_task(t, raise_on_marker_error=False) for t in raw]`) must
    be grammar-aware like the other two call sites — assert that `--check --renders` on
    the claims fixture emits NO legacy steps/referent advisory that reads a slot body as
    legacy prose, and DOES emit the new `ADVISORY grammar:` lines above.
  - Legacy pin: the wide/chained fixture assertions in
    `tests/test_compile_plan_claims.py` at BASE still pass untouched.
- [ ] **Step 2: Run; verify failures.**
- [ ] **Step 3: Implement** inside the claims-v1 branch only: skip `TEXT_DEP` scanning;
  suppress the `undeclared-dependency` `add_conflict` call when the plan grammar is
  claims-v1 (legacy path untouched); thread `grammar=plan_grammar(...)` into
  `render_advisories()`'s `parse_task` call site; add the ordering-phrase advisory
  (regex `\bafter Task\s+\w+` over fence-stripped slot prose); emit the
  unmatched-Consumes and Context-count advisories through the existing `ADVISORY`
  channel; add the non-text classifier (`is_binary`: read first 8 KB, binary iff it
  contains a NUL byte, resolved against the provided tree root; symlinks via
  `Path.is_symlink()`).
- [ ] **Step 4: Full suite green; commit.**

### Task 2: Provenance hardening — the vacuous-pass guard

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrawrite/scripts/check_provenance.py`
- Test: `tests/test_check_provenance.py`

**Interfaces:**
- Consumes: `check_provenance.py <plan.md> --gh <cmd>` CLI (at BASE since PR #520)
- Produces: nothing downstream

- [ ] **Step 1: Write failing test** (same fake-`gh` pattern the file already uses,
  fresh tmp_path per test): a task whose Claim is nothing but its provenance tag —
  `**Claim:** (quoted from #489)` — exits 2 with a failure line containing
  `empty operator sentence`, even when #489 resolves. (run-43 finding: the stripped
  sentence is `""`, and `"" not in body` is always False, so it signed off vacuously.)
- [ ] **Step 2: Run; verify failure.**
- [ ] **Step 3: Implement** the guard in `check_provenance.py`: after stripping the
  provenance tag, an empty operator sentence appends a failure instead of comparing.
- [ ] **Step 4: Full suite green; commit.**

### Task 3: The `ultrawrite` skill — marker layout pinned to the parser

**Type:** implementation
**Review:** adversarial
**Depends-on:** none

**Files:**
- Create: `skills/ultrawrite/SKILL.md`
- Test: `tests/test_ultrawrite_skill.py`

**Interfaces:**
- Consumes: nothing (prose; the scripts it references are at BASE since PR #520)
- Produces: `skills/ultrawrite/SKILL.md` carrying the rubric tokens `Ultrapowers`, `Subagent-Driven`, `Inline`, `parallel width`, `risk override`, `T≥4`, `loops/cursors/pagination/budgets/termination logic` (Task 4 re-points the lockstep test at this file)

**Parallelization rationale:** pure prose against a fixed spec; shares nothing with the
compiler tasks.

- [ ] **Step 1: Write failing test** `tests/test_ultrawrite_skill.py`: the file exists;
  frontmatter `name:` is `ultrawrite`; contains the line
  `Audience: the authoring agent`; contains each of the seven rubric tokens above;
  contains the six slot names in order; contains no `**Depends-on:**` and no
  `**Tier:**` string anywhere; contains the exact sentence
  `Header markers: **Type:** and optionally **Review:** — nothing else; **Files:** is not a marker and ends the header block.`;
  names both scripts (`extract_gate_input.py`, `check_provenance.py`) and the
  validation command `compile_plan.py --check`.
- [ ] **Step 2: Author the skill** per spec §§2–5, with the marker teaching pinned to
  what the parser does (run-43's Task-5 failure was teaching a layout the compiler
  silently drops — compile_plan.py's header block ends at the first non-marker line,
  and only `Type`/`Depends-on`/`Review`/`Commutes` are marker-shaped, so):
  - Header markers: `**Type:**` and optionally `**Review:**`, in the contiguous block
    immediately after the task heading. Include the pinned sentence from Step 1
    verbatim. There is NO `**Tier:**` plan marker — tier is an intent-document field
    (One Driver spec §7), never a plan marker.
  - Then the `**Files:**` block, then the six body slots in order:
    Claim / Authorized-by / Interfaces / Context / Proof / Stale-if.
  - Remaining sections as in the spec: claim elicitation (quote-from-issue path,
    bare-idea interview path, the bilingual pair, do:/see: craft); the proof-gate
    ritual (extractor → one fresh-context subagent per task fed ONLY the extractor
    output → verdicts to the sibling `.gate-verdicts.json` → provenance script →
    `compile_plan.py --check`); the worktree-pure contract; decomposition judgment
    (contract-first + good-engineer gate + escape valve + let-same-file-edits-stand +
    prefer small concurrent plans, with the Tier-2 stopgap); Global Constraints
    discipline (result-claims, never process rules); the execution-fit rubric and
    three-option handoff (verbatim token parity with `hooks/session_start.sh`);
    Acceptance dispositions (suite/waived). No MIT notice — no verbatim superpowers
    text is carried; do not paste any writing-plans sentences.
- [ ] **Step 3: Validate:**
  `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrawrite` exits 0.
- [ ] **Step 4: Full suite green; commit.**

### Task 4: Deletions and re-points

**Type:** implementation
**Review:** adversarial
**Depends-on:** 3

**Files:**
- Modify: `hooks/session_start.sh`
- Modify: `skills/ultrapowers/references/plan-markers.md`
- Modify: `skills/ultrapowers/scripts/ultra_run.py`
- Modify: `tests/test_recommendation_rubric.py`
- Modify: `tests/test_session_hook.py`
- Modify: `tests/test_marker_contract.py`
- Modify: `.github/workflows/ci.yml`
- Modify: `skills/ultrawrite/SKILL.md`

**Interfaces:**
- Consumes: `skills/ultrawrite/SKILL.md` rubric tokens (from Task 3)
- Produces: nothing downstream

- [ ] **Step 1: Delete** (git rm): `skills/ultraplan/` (whole directory),
  `skills/ultrapowers/scripts/check_superpowers_compat.py`,
  `skills/ultrapowers/scripts/resolve_superpowers.py`,
  `skills/ultrapowers/scripts/superpowers_contract.py`,
  `tests/test_resolve_superpowers.py`, `tests/test_superpowers_contract.py`,
  `tests/test_superpowers_compat.py`, `tests/test_check_superpowers_compat.py`,
  `tests/test_ultraplan_skill.py`.
- [ ] **Step 2: Excise the call site** — `ultra_run.py` invokes
  `check_superpowers_compat.py` (one `sh([...])` call around line 348); remove that
  call and its result handling; grep the file for `superpowers` to confirm zero hits.
- [ ] **Step 3: Trim `plan-markers.md`** to the runtime half: keep the worktree-pure
  contract, Type semantics, classification heuristics, compile-time obligations, Files
  grammar, Interfaces grammar; delete the authoring-rules section, the Executor
  variance section, and the `Depends-on`/`Commutes` authoring-guidance paragraphs.
  Keep the `<!-- BAKE: -->` blocks `test_marker_contract.py` pins; update that test
  only where it asserts text in the deleted sections.
- [ ] **Step 4: Re-point the rubric lockstep** — in `test_recommendation_rubric.py`
  change `ULTRAPLAN = ROOT / "skills/ultraplan/SKILL.md"` to
  `ULTRAWRITE = ROOT / "skills/ultrawrite/SKILL.md"` (all uses renamed); update
  `tests/test_session_hook.py` references from ultraplan to ultrawrite; edit
  `hooks/session_start.sh` rule 1 to invoke `ultrapowers:ultrawrite` for every
  implementation plan (drop the writing-plans co-invocation sentence), keeping every
  rubric token byte-identical.
- [ ] **Step 5: CI** — in `.github/workflows/ci.yml` replace the
  `Validate ultraplan skill` step with `Validate ultrawrite skill`
  (`python skills/ultrapowers/scripts/validate_skill.py skills/ultrawrite`).
- [ ] **Step 6: Full suite green** (`python3 -m pytest`); grep the tracked tree
  (excluding `docs/`, `evals/results/`, `.claude/`) for `ultraplan` and confirm the
  survivors are historical docs only; commit.

### Task 5: CLAUDE.md, README, marketplace wording

**Type:** implementation
**Depends-on:** 4

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Modify: `.claude-plugin/marketplace.json`

**Interfaces:**
- Consumes: the post-Task-4 tree (describes it)
- Produces: nothing downstream

- [ ] **Step 1: CLAUDE.md** — delete the "extends (does not fork)" sentence and its
  LIFTED annotation (replace with one line: the plugin owns plan authoring via
  `ultrawrite` since #390); update the Layout section (`skills/ultraplan/` →
  `skills/ultrawrite/`, and remove the stale claim that ultraplan "mirrors
  `references/plan-markers.md`"); update the "How features are built here" line
  (`superpowers:writing-plans` + `ultrapowers:ultraplan` markers →
  `ultrapowers:ultrawrite`).
- [ ] **Step 2: README + marketplace** — rewrite the authoring-pipeline description:
  superpowers is no longer required for plan authoring (brainstorming and the practice
  skills remain optional companions); sequential-executor wording states the weaker
  property: a claims-v1 plan has no steps to follow, but a sequential executor can
  implement task-by-task from contract + proof.
- [ ] **Step 3: Full suite green; commit.**

### Task 6: Release 0.3.2

**Type:** release
**Depends-on:** 5

**Files:**
- Modify: `.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`

- [ ] **Step 1:** Bump BOTH `plugin.json` and `marketplace.json` to `0.3.2` (patch —
  operator call; they drift silently if either is missed).
- [ ] **Step 2:** Commit `chore(release): 0.3.2 — the #390 cutover: ultrawrite +
  claims-v1; ultraplan and the superpowers authoring dependency deleted` with the
  skill prose sizes in the body (reported, not gated). Push to `main`.
- [ ] **Step 3:** Confirm CI green: `gh run list --branch main --limit 1`.

## Operator smoke

- do: open a terminal in a scratch project with the plugin updated, start a new session,
  and type "help me plan a small feature"
- see: the session announces `ultrawrite` (never ultraplan or writing-plans) as the
  authoring skill
- do: `python3 skills/ultrapowers/scripts/compile_plan.py --check evals/fixtures/claims/plan.md`
- see: `PLAN OK` with `ADVISORY grammar: Context is N words` lines — and NO
  "undeclared dependency" finding anywhere
- do: add a `- [ ] **Step 1:**` line to a task in a copy of the claims fixture and
  re-run the same `--check`
- see: `grammar: Steps are not a slot` — procedure has nowhere to live
- do: `python3 skills/ultrapowers/scripts/compile_plan.py --check evals/fixtures/wide/plan.md`
- see: `PLAN OK` — the legacy path untouched; the rollback door open
