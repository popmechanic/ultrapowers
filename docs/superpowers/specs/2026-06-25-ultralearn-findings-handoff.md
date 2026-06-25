# Handoff: conquering the ultralearn cross-project findings

**Date:** 2026-06-25 · **Author of scan:** ultralearn full-corpus sense+distill pass
**Purpose:** seed a fresh session that will turn these findings into ONE implementation
plan (`superpowers:writing-plans` + `ultrapowers:ultraplan`) and execute it. This doc
is self-contained — a session with no prior context can act on it.

---

## 0. TL;DR for the next session

ultralearn harvested **62 real `/ultrapowers` runs** across all your projects, read
**48** of them through 5 lenses, and merged **219 findings** into
`docs/superpowers/observations/ledger.jsonl`. After dropping what's already fixed,
the actionable work is **6 workstreams (P1–P6)**. Two are top-priority, fully-open,
cross-project, severity-3 clusters:

- **P1 — make the pre-merge report surface *incompleteness*** (false-green is the #1 failure mode)
- **P2 — worktree / checkout / concurrency determinism**

Then P3 (harvester precision — the tool that powers ultralearn itself), P4 (ultraplan
compiler), P5 (launch/sealed/result-schema), P6 (merge-topology/finishing).

**Already shipped — do NOT re-file (verify, then skip):**
- **Tier-floor / auto-escalate** → shipped in **0.0.20** (`waves.js` `escalateTier` + agent-error retry; `audit_run.py` `thrashCandidates`/`escalatedTasks`). A 46-ish-finding cluster, now largely obsolete.
- **Harvester extractors** (`_plan_path`/`_transcript_dir`/`_gate_report`) → fixed in **PR #66**.
- 5 findings tagged `status: likely-resolved` (see §3).

---

## 1. How to read the corpus (do this first)

The committed ledger is the source of truth:

```bash
# every finding (219), newline-delimited JSON
wc -l docs/superpowers/observations/ledger.jsonl
# human digest (regenerated from the jsonl)
docs/superpowers/observations/ledger.md
```

**Finding schema** (each line):
`runId, lens(friction|routing|operator|cost|frontier), title, novelty(0-2),
severity(0-3), evidence, evidenceAbstracted, implication, surface, id, origin(home|foreign),
engineEpoch, engineBasis, status(open|likely-resolved)`.

**Pull a workstream's full findings (with verbatim evidence):**
```bash
# by surface
python3 -c "import json;[print(f['id'],f['severity'],f['engineEpoch'],f['title']) \
 for f in map(json.loads,open('docs/superpowers/observations/ledger.jsonl')) \
 if f['surface']=='report-format.md' and f['status']=='open']"
# one finding's full text by id
python3 -c "import json;[print(json.dumps(f,indent=2)) \
 for f in map(json.loads,open('docs/superpowers/observations/ledger.jsonl')) if f['id']=='4afb72b815e86d8b']"
```

**Deeper evidence** lives in the gitignored local cache (raw bundles + transcript
slices), keyed by `runId`: `~/.claude/ultralearn/runs/<runId>/{bundle.json,slice.md}`.
Home-run slices carry verbatim transcripts; foreign slices are abstracted in the ledger
but the raw slice is local-only.

### Epoch semantics (read before trusting any "still live?" judgment)
- `engineEpoch` = the ultrapowers version current when the run launched, from
  `.claude-plugin/plugin.json` git history mapped by timestamp (handles the
  **0.x → 0.0.x reset on 2026-06-11**; resolution is date-ordered, not semver).
- `engineBasis`: `home-repo-date` = tight (self-dev run, may be at/ahead of epoch);
  `foreign-date-upper-bound` = the installed plugin cache could *lag* this, so treat
  foreign epochs as an upper bound.
- **The whole corpus tops out at epoch 0.0.18. The engine is now 0.0.20.** So *every*
  finding predates the current engine. "Still live?" must be decided by reading
  current code, not by the finding alone. Epoch is a *narrowing* signal: a finding at
  0.0.6 is more likely incidentally fixed than one at 0.0.18.

### Privacy (the repo is public)
Home findings may quote verbatim; foreign findings are abstracted (`evidenceAbstracted:
true`, identifiers stripped). The merge guard drops non-abstracted foreign evidence.
**Keep this invariant** if you regenerate the ledger.

---

## 2. The current engine state (what's already done)

| Shipped | Where | Retires |
|---|---|---|
| Tier auto-escalate on StructuredOutput agent-error | `harnesses/waves.js` `escalateTier`/`runTask` (0.0.20) | the tier-floor cluster headline |
| Absolute-thrash + escalated-task + errored-agent audit signals | `skills/ultrapowers/scripts/audit_run.py` (0.0.20) | the audit_run misrank blind-spot findings |
| Harvester extractors anchored on Workflow structure | `harvest_runs.py` `_plan_path`/`_transcript_dir`/`_gate_report` (PR #66) | the 3 extractor findings in P3 |
| ultralearn feedback loop itself | `skills/ultralearn/` (0.0.19) | — |
| Engine-version dimension on the ledger | this session | enables epoch-aware ranking |

**Open issues already filed:** #64 (harvester — extractor core done in #66; **meta-session
classifier + `--session` still open** → P3), #65 (ultraplan Files-parser + description-edge
guidance → P4). Spec stub: `docs/superpowers/specs/2026-06-25-tier-floor-structured-implementer.md`.

---

## 3. Already-resolved findings (status: likely-resolved — verify, don't re-plan)

| id | sev | epoch | what shipped |
|---|---|---|---|
| (post-checkout #32) | 2 | 0.2.0 | restore session checkout to baseBranch at run end |
| (meta is not defined #7) | 2 | 0.2.0 | `typeof meta` guard in the committed harness |
| (null agent() on Overloaded) | 3 | 0.0.13 | null-guard + regression test at critic dispatch |
| (sealed-exam false-red) | 0 | 0.0.11 | bootstrapCmd-before-suite + 3-way red classification |
| (registry snapshot fresh-checkout) | 2 | 0.0.10 | SessionStart-hook install (PR #45 / 0.0.11) |

---

## 4. The workstreams to conquer

Severities and epochs are from the ledger; `[id]` anchors let you pull full evidence.
"Magnitude" counts overlap across themes — treat as directional.

### P1 — Pre-merge report must distinguish "green suite" from "done"  ·  TOP PRIORITY
**~50 open findings · ~10 projects · sev-3 · epochs to 0.0.18 · nothing post-corpus touches it**

False-green is the single most common failure mode across the corpus, and the
completeness critic is the only thing currently catching it. Representative anchors:

- `[4afb72b815e86d8b]` s3 0.0.18 — all-green suite-acceptance gate coexisted with a real boot-time runtime defect the suite couldn't reach.
- `[e13115e8fb3275f6]` s3 0.0.10 (home) — a prior run's critic warned "green but incomplete"; a half-merged plan passed its own suite because only existing tests can fail.
- `[fbbfab723f1eab2e]` s3 0.0.13 — transient model-overload killed a mid-DAG task; gate stayed green because the dropped subtree's tests were absent.
- `[33605b21f5894b14]` s3 0.0.11 — a completed, correct task's branch silently dropped during wave integration.
- `[12211b649f4f7336]` s3 0.0.13 — generated codegen artifacts went stale across worktrees, producing a false green.
- `[cec1d591d298df39]` s3 0.0.8 (home) — completeness critic reviewed a STALE DETACHED tree and raised false-alarm gaps (#29 lineage).
- `[f396cfe4bf66c1af]` s3 0.0.14 — sealed-exam runner can't certify a non-pytest suite; passing tests returned a blocking non-zero exit.

**Proposed change (`report-format.md` + the Step-5 gate):**
1. **Coverage column** `tasks_merged / tasks_planned` beside suite-green, with a ⚠ when green-but-coverage<100%.
2. **Deliverable-presence cross-check**: on any failed/cascade-blocked task, diff the plan's `Create:` paths against the integration tree and flag missing deliverables loudly.
3. **git-verified vs critic-asserted** split: auto-ground-truth the critic's "clean"/"gap" claims against `git` (rev-parse HEAD on the integration branch) — make the #29-style wrong-tree review a hard error, not a confident hallucination.
4. **`visualEyeballItems[]`** structured channel for "verified-by-construction but needs a browser" so the operator's attention goes exactly there.

**Acceptance:** suite (engine/report changes). Add fixtures where a blocked subtree makes the suite vacuously green and assert the report flags it.

---

### P2 — Worktree / checkout / concurrency determinism  ·  TOP PRIORITY
**~50 open findings · ~10 projects · sev-3 · epochs to 0.0.18**

The class is wide open (only the #32-specific finding is resolved). Anchors:

- `[d3329657e0b6fbec]` s3 0.0.13 — engine launched a headless run from a session NOT rooted in the git repo; worktree binding put work in the wrong tree.
- `[02b3fec6c5122a9c]` s3 0.1.0 (home) — read-only probe proved `isolation:'worktree'` binds to the SESSION repo regardless of any baked target path.
- `[40e2f6491024d6f4]` s3 0.0.11 — post-run worktrees not swept; repo nearly committed 13+ embedded git repositories.
- `[bcc72f2be9eebeeb]` s3 0.0.12 (home) — `/verify` failed the audit-drawer on its own canonical run; role-classify regex drifted from the real prompt.
- Concurrency: multiple sources show two `/ultrapowers` runs in one repo fast-forwarding each other's checkout; repo-wide `sweep_worktrees.sh` would damage a sibling run.

**Proposed change (`the engine harness` + `SKILL.md`):**
1. **Run lockfile** (`.claude/ultrapowers/RUN_LOCK` with the live runId) checked at setup and Step-5 → turn silent concurrent-run corruption into a loud refusal (enforces the existing "serialize runs" rule).
2. **Scope `sweep` to `wf_<runId>-*`** by default, not repo-wide.
3. **Critic/merge agents must assert they're on the integration HEAD** (echo `git rev-parse HEAD` + branch; abort on mismatch).
4. **Never leave a worktree holding the default branch**; snapshot+restore the primary checkout's HEAD around the run.
5. Cleanup is a **deterministic actor**, never a merge-prompt instruction.

⚠ Engine-prompt edits are **baked** — see §5 anti-drift rule.

---

### P3 — Harvester precision (ultralearn self-improvement; extends #64)
**~20 open findings · `harvest_runs.py` · extractor core fixed (#66), classifier residual open**

This is the tool that produces the corpus distill reads — high leverage. The 3
extractor findings (`[391cf0d3932b2842]` planPath, `[4af4b4b1e6e96767]` transcriptDir,
`[34581e19d64e5f32]` gateReport) are **fixed by #66** — verify, then skip. Residual:

- `[6f4b149bf481d212]` / `[c9b028bf4da18d99]` — non-`/ultrapowers` read-only research Workflows swept in as engine runs (role:unknown mega-runs). **Need a meta-session / engine-fingerprint classifier** (integration branch + setup/merge/review roles + planningFound).
- `[4fd31a3d81a71b36]` (home) — two bundles are the SAME run double-emitted (`ee606…`≡`85db…`); **dedup by transcriptDir/workflow-runId** + assert sessionId matches.
- `[a2376d0fea405c08]` (home) — slice and audit can come from DIFFERENT runs glued into one bundle; **pair slice↔audit provenance**, or one bundle per `wf_*` (a session can host multiple launches).
- Slice **bloat truncation** (drop large pasted-file user turns), and a **`--session`/`--project` targeting flag** (first-class "run ultralearn on session X").

**Acceptance:** suite (`tests/test_harvest_runs.py`). Add fixtures for a non-engine Workflow session and a multi-launch session.

---

### P4 — ultraplan authoring & compiler robustness (extends #65)
**~8–12 open findings · `ultraplan` / `compile_plan.py` · epochs to 0.0.18**

- `[76c7ef053adbf62e]` 0.0.18 (home) — Files-label parser drops `Test fixture(s):`, bare `- None`, and dotfiles (`.gitignore`). (= #65)
- `[108894a8435da7c7]` (home) — a backticked sibling filename in a `Produces:` *description* injects a phantom DAG edge that serializes parallel work; promote "describe siblings by role, not filename" to a hard rule + a distinct "edge-inferred-from-description" warning class. (= #65)
- `[c171bd23cbab3265]` 0.0.6 — a verification task with empty `writes` got a fan-in edge from every upstream task → forced serial tail; classify empty-writes-+-only-build/QA tasks as **gate**, not implementation.
- `[8f9af8d0c8afd37b]` 0.0.6 — unmarked plan compiled entirely by heuristic with no loud flag; surface "0 markers — all dispositions inferred" at the transparency render.
- `[a2fade95c36b2357]` 0.0.11 — a plan asserted a token absent that was never present at BASE (vacuous): add a **RED-at-BASE check** for absence-assertions, mirroring the sealed-exam RED-proof.
- `[c682212cdeb736ad]` 0.0.17 — gate/non-task headings leaked markers into the preceding task (fence-aware authoring).

---

### P5 — Launch contract / sealed-acceptance / result-schema residuals
**~15 open findings · several already resolved · `SKILL.md` + engine harness**

- `[4eb3bedd77a4b023]` 0.0.13 (home) — `/ultrapowers` hands the engine a **raw plan-path** as `args`, contradicting the compiled-`{waves,…}` contract; it "works" only because the orchestrator notices the throw and re-routes (a wasted launch + confusing first error every run). The command should invoke the skill, never call Workflow with a path.
- `[fb8635c59d4fea1c]` 0.0.13 — saved-workflow-by-`meta.name` launch silently failed to deliver args 3× (duplicate-name resolution); GC stale-named duplicates on install.
- `[ae56a1205e971b82]` 0.0.8 (home) — version skew: `/ultrapowers` would launch the stale cached engine while repo main differs; add a cache-vs-repo **preflight**.
- `[cbf0d886651f723c]` 0.0.17 — Step-5 **result-schema guard**: the deterministic merge-sha check crashed on a missing `waveMerges` key (pin the result schema; degrade gracefully).
- Sealed: support **non-pytest acceptance suites** (the `f396cfe4` exit-code issue also surfaces here).

---

### P6 — Merge topology / finishing handoff
**~5 open findings · `the engine harness` + finishing handoff + CI**

- `[b117ab5d53e5b96a]` s3 0.0.17 — accumulated per-wave merge commits make the integration branch **un-rebaseable**, blocking repos that forbid merge commits; the finishing handoff should detect the target repo's allowed merge methods and recommend squash up front.
- `[64016ca13dd763a4]` 0.0.14 — deploy-scope trap: a tiny approved fix on a long feature branch would push the whole branch to prod; warn when the base is far ahead of the deploy target.
- `[5000bc37c482ec5c]` (home) — `marketplace.json` silently lagged `plugin.json`; add a **CI/pytest assertion** that the two versions match (this is a known CLAUDE.md gotcha — cheap, high-value).

---

### Residual / "other" bucket (18 findings — review, mostly operator/process)
Notable: `[1afee068175f81d8]` s3 — a `/goal` Stop-hook drove a **non-terminating**
self-review loop (N-consecutive-clean-rounds is unsafe against an open grammar; cap
iterations / weight by realistic impact). Plus operator-arc findings (gate declined →
run stranded; gate mis-approved after idle; plan-authoring hit a one-Write generation
limit → chunk). These are smaller; fold into the relevant workstream or defer.

---

## 5. Guidance for the planning session (read before writing the plan)

**Surfaces map (sequence by shared files to avoid same-file serialization):**
- `report-format.md` + the Step-5 gate → **P1** (and the report bits of P5/P6).
- `harnesses/waves.js` + `SKILL.md` → **P2** (and launch bits of P5). These are the
  heaviest, highest-risk engine edits.
- `skills/ultralearn/scripts/harvest_runs.py` + `tests/test_harvest_runs.py` → **P3** (isolated; parallelizes cleanly).
- `skills/ultraplan/` + `skills/ultrapowers/scripts/compile_plan.py` → **P4** (isolated).
- finishing handoff + `.github/workflows/ci.yml` → **P6** (isolated).

**Hard rules this repo enforces (CLAUDE.md):**
- **Baked prompts:** engine prompts in `harnesses/waves.js` are baked from
  `references/reviewer-prompts.md` + `references/wave-merge.md` and pinned by
  `tests/test_no_prompt_drift.py`. For P1/P2 engine-prompt changes, **edit the source
  `.md`, re-bake, keep the pin green — never edit only the baked copy.**
- **Test gate:** `python3 -m pytest` (scoped by pytest.ini). CI also runs
  `validate_skill.py` on `ultrapowers` + `ultraplan`.
- **Versioning stays `0.0.x`; a release bumps BOTH `plugin.json` AND `marketplace.json`** (P6 adds a guard for exactly this).
- **No direct Anthropic API calls** in any shipped/dev script.
- **Serialize `/ultrapowers` runs** in this repo (P2 makes this enforceable; until then,
  if you self-host the execution, run one at a time and sweep with `sweep_worktrees.sh`).

**Suggested shape for "conquer in one session":** P3, P4, P6 are isolated and
parallelize as independent waves. P1 and P2 are the deep engine work (report + gate +
worktree/concurrency) and should each be their own wave with adversarial review;
because both touch the gate/`SKILL.md`/baked prompts, treat them as same-surface
(serialize P1↔P2 on the shared gate code, or split along clean file seams). Mark the
plan with `ultraplan` Type/Depends-on, `**Acceptance:** suite`, and route it through
the execution-fit analysis (this is a high-stakes, parallel-width, T≥4 plan → it will
recommend Ultrapowers).

**Definition of done per workstream:** a fixture/test that reproduces the failure
(red at base) + the fix (green) + the ledger anchor id referenced in the task body.

---

## 6. Appendix — regenerate / re-query

```bash
# top open findings by severity×novelty
python3 -c "import json;L=[f for f in map(json.loads,open('docs/superpowers/observations/ledger.jsonl')) if f['status']=='open'];\
[print(f['id'],f['severity'],f['engineEpoch'],f['surface'],f['title'][:70]) for f in sorted(L,key=lambda x:-(x['severity']*(x['novelty']+1)))[:30]]"

# count open findings per surface
python3 -c "import json,collections;c=collections.Counter(f['surface'] for f in map(json.loads,open('docs/superpowers/observations/ledger.jsonl')) if f['status']=='open');print(c.most_common())"
```

Corpus stats: 62 bundles harvested (19 home / 43 foreign), 48 read (11 synthetic
eval fixtures + 1 already-merged dogfood excluded), 219 findings / 48 runs, 90 home /
129 foreign, 0 foreign-not-abstracted, epochs 0.1.0→0.0.18.
