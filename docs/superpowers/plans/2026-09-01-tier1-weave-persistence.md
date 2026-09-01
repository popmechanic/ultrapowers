# Tier-1 Weave Persistence Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Acceptance:** suite — the committed suite is the verification.

**Goal:** Persist the per-file manyana weave across waves (emit on adopt, shadow-seed the next fold, record divergences) and delete the authoring prose whose failure classes the fold measurements retired.

**Architecture:** The live fold path stays byte-for-byte unchanged. A new `emit-weave` kernel subcommand serializes per-path state strings as content-addressed blobs plus a manifest after each ADOPTED wave; the next wave's fold, when the manifest matches git's blobs at its base, additionally folds a seeded copy **in memory as a shadow** and records whether the outcomes agree. All weave records ride a sidecar, never the fold log.

**Tech Stack:** Python 3 (kernel, pytest), Node (fleet engine, .mjs sims).

**Spec:** `docs/superpowers/specs/2026-09-01-tier1-weave-persistence.md`

## Global Constraints

- `skills/ultrapowers/kernel/vendor/manyana.py` is never modified (sha-pinned by `tests/test_frontier_kernel.py`).
- `kernel/FOLD_LOG.md`'s event vocabulary stays exactly three types (`base`, `fold`, `resolve`); no weave record ever enters `fold_log.jsonl`.
- The live fold/resolve/materialize behavior is byte-identical with and without a weave dir present: seeding is shadow-only; a broken/absent/corrupt weave dir must never fail, park, or alter a wave (worst case: a sidecar event and a fresh fold, which is today's behavior).
- `fleet/roles/*.md` untouched (350-word ceiling files).
- No new dependencies in any `package.json` or Python import beyond the standard library.
- Result-shape constraint for prose tasks: the deleted passages are gone, the retained contracts (Commutes rules, #233 blast radius, non-text exception, marker grammar) survive verbatim, and `python3 -m pytest tests/ -q` is green.

---

### Task 1: `emit-weave` — serialize the adopted wave's states

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/kernel/fold_wave.py`
- Modify: `skills/ultrapowers/kernel/frontier_fold.py`
- Test: `tests/test_weave_persistence.py`

**Interfaces:**
- Consumes: `frontier_fold.rehydrate(repo, log_path)`, `repo_weave.split_lines`
- Produces: CLI `fold_wave.py emit-weave --repo R --run-dir D --wave N --adopt-head SHA` printing `{"emitted": int, "superseded": int}`; `FrontierEngine.state_strings() -> dict[str, str]` (path → serialized manyana state); `load_weave_manifest(run_dir: Path) -> dict | None` reading `<run_dir>/frontier/weave/manifest.json`; weave layout `frontier/weave/{blobs/<sha256>, manifest.json, weave-events.jsonl}` with manifest shape `{"wave": N, "entries": {path: {"stateBlob": sha256hex, "visibleSha": gitBlobSha}}}`.

- [ ] **Step 1: Write the failing tests** in `tests/test_weave_persistence.py`. Build a throwaway git repo in `tmp_path` (the pattern at the top of `tests/test_fold_wave.py` — reuse its helpers if importable, else a minimal `_git()` runner): commit a base with `app.py` (3 lines), create one task branch editing line 2, run `fold_wave.py fold` then `materialize` via `subprocess` exactly as `tests/test_fold_wave.py` does, commit the candidate as the adopt head. Then:

```python
def test_emit_weave_writes_blobs_manifest_and_events(fold_env):
    out = run_cli(fold_env, ["emit-weave", "--repo", ".", "--run-dir", str(fold_env.run_dir),
                             "--wave", "1", "--adopt-head", fold_env.adopt_sha])
    reply = json.loads(out.stdout)
    assert reply == {"emitted": 1, "superseded": 0}
    weave = fold_env.run_dir / "frontier" / "weave"
    manifest = json.loads((weave / "manifest.json").read_text())
    assert manifest["wave"] == 1
    entry = manifest["entries"]["app.py"]
    blob = (weave / "blobs" / entry["stateBlob"]).read_text()
    assert hashlib.sha256(blob.encode()).hexdigest() == entry["stateBlob"]
    # visibleSha is git's own blob sha for the adopted file
    expected = fold_env.git("rev-parse", fold_env.adopt_sha + ":app.py").strip()
    assert entry["visibleSha"] == expected
    events = [json.loads(l) for l in (weave / "weave-events.jsonl").read_text().splitlines()]
    assert {"event": "emitted", "wave": 1, "path": "app.py"}.items() <= events[-1].items()

def test_emit_weave_marks_reconciled_paths_superseded(fold_env):
    # amend the adopt head so app.py's blob differs from the fold's visible lines
    (fold_env.repo / "app.py").write_text("reconciled\n")
    fold_env.git("add", "-A"); fold_env.git("commit", "-m", "reconcile")
    head = fold_env.git("rev-parse", "HEAD").strip()
    reply = json.loads(run_cli(fold_env, ["emit-weave", "--repo", ".", "--run-dir",
        str(fold_env.run_dir), "--wave", "1", "--adopt-head", head]).stdout)
    assert reply == {"emitted": 0, "superseded": 1}
    manifest = json.loads((fold_env.run_dir / "frontier/weave/manifest.json").read_text())
    assert "app.py" not in manifest["entries"]

def test_state_strings_round_trips_through_manyana():
    eng = ff.FrontierEngine(rw.Snapshot(files={"a.py": manyana.initial_state(["x"])}, ...))
    s = eng.state_strings()
    assert manyana.current_lines(s["a.py"]) == ["x"]

def test_emit_weave_refuses_incomplete_fold(fold_env_incomplete):
    r = run_cli(fold_env_incomplete, ["emit-weave", ...], expect_code=2)
    assert "incomplete" in r.stderr
```
(Adjust the `Snapshot` construction to `repo_weave`'s real base type — read `snapshot_scoped`'s return and build via the same constructor; the assertion contract above is fixed, the fixture plumbing is the implementer's.)

- [ ] **Step 2: Run them** — `python3 -m pytest tests/test_weave_persistence.py -v` — all FAIL (no subcommand, no accessor).
- [ ] **Step 3: Implement.** In `frontier_fold.py`, add to `FrontierEngine`:

```python
def state_strings(self):
    """Per-path serialized weave states of the current frontier (raw manyana
    state strings — the persistence unit; Tier 1, spec 2026-09-01)."""
    return dict(self._files)   # whatever attr holds path -> state; return a copy
```

In `fold_wave.py`, add `cmd_emit_weave(args)` + `load_weave_manifest(run_dir)` + the `emit-weave` subparser (`--repo`, `--run-dir`, `--wave` int, `--adopt-head`, all required). Behavior: refuse (exit 2, stderr) when the fold log is missing or the fold is incomplete (reuse the completeness derivation in `cmd_materialize` — fold events cover no unresolved paths); `eng = ff.rehydrate(repo, log_path)`; for each path in `eng.state_strings()`: `visible = current_lines`; compute git's sha via `git hash-object --stdin` over `"\n".join(visible) + ("\n" if visible else "")`; compare to `git rev-parse <adopt-head>:<path>` (a path absent at adopt-head, or sha mismatch → `superseded` sidecar event, no manifest entry); else write blob `frontier/weave/blobs/<sha256(state)>` (skip if exists — content addressing), manifest entry, `emitted` event. Manifest is REPLACED wholesale each call (`{"wave": N, "entries": ...}`) — the newest adopted wave owns it. Append events to `weave-events.jsonl` (one JSON object per line, each carrying `event`, `wave`, `path`).
- [ ] **Step 4: Run the tests** — PASS. Also `python3 -m pytest tests/test_fold_wave.py tests/test_frontier_fold.py -q` — untouched behavior green.
- [ ] **Step 5: Commit** — `git commit -m "kernel: emit-weave — persist adopted wave states (Tier 1, map #360)"`

### Task 2: shadow seeding + the divergence record

**Type:** implementation
**Depends-on:** 1
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/kernel/fold_wave.py`
- Test: `tests/test_weave_shadow.py`

**Interfaces:**
- Consumes: `load_weave_manifest(run_dir)` and the weave layout (Task 1); `_prepare`, `_pre_scan`, `ff.FrontierEngine`, `rw.publish` (existing).
- Produces: sidecar event vocabulary `seeded` / `drift` / `divergence` / `shadow-skipped` (fields: `event`, `wave`, `path` or `paths`, and for `divergence`: `freshTree`, `seededTree` — the two visible-tree sha256s).

- [ ] **Step 1: Write the failing tests** in `tests/test_weave_shadow.py` (same `fold_env` style; two-wave setup: wave 1 fold+materialize+emit-weave via CLI, adopt, then wave 2 whose base is the adopt head and whose one task edits the same file):

```python
def test_wave2_fold_records_seeded_event_and_no_divergence(two_wave_env):
    out = run_cli(two_wave_env, ["fold", "--repo", ".", "--run-dir", str(two_wave_env.run_dir),
                                 "--wave", "2", "--base", two_wave_env.adopt_sha,
                                 "--patch", "1=" + str(two_wave_env.wave2_patch)])
    assert json.loads(out.stdout)["complete"] is True
    events = read_events(two_wave_env)          # weave-events.jsonl lines
    kinds = [e["event"] for e in events]
    assert "seeded" in kinds and "divergence" not in kinds and "drift" not in kinds
    seeded = [e for e in events if e["event"] == "seeded"][-1]
    assert seeded["wave"] == 2 and seeded["path"] == "app.py"

def test_manifest_mismatch_records_drift_not_seed(two_wave_env):
    # corrupt the manifest's visibleSha so addressing disagrees with git
    poison_manifest(two_wave_env, "app.py", visibleSha="0" * 40)
    run_cli(two_wave_env, ["fold", ...wave2 args...])
    kinds = [e["event"] for e in read_events(two_wave_env)]
    assert "drift" in kinds and "seeded" not in kinds

def test_missing_or_corrupt_weave_dir_changes_nothing(two_wave_env):
    shutil.rmtree(two_wave_env.run_dir / "frontier/weave")
    out = run_cli(two_wave_env, ["fold", ...wave2 args...])
    assert json.loads(out.stdout)["complete"] is True   # plain fresh fold, no events file

def test_fold_reply_json_is_byte_identical_with_and_without_weave(two_wave_env_pair):
    with_weave, without_weave = two_wave_env_pair       # identical repos, one weave dir removed
    a = run_cli(with_weave, ["fold", ...]).stdout
    b = run_cli(without_weave, ["fold", ...]).stdout
    assert a == b                                        # the live path is untouched

def test_conflicted_wave_records_shadow_skipped(conflicted_two_wave_env):
    run_cli(conflicted_two_wave_env, ["fold", ...])      # wave 2: two tasks colliding
    kinds = [e["event"] for e in read_events(conflicted_two_wave_env)]
    assert "shadow-skipped" in kinds and "seeded" not in kinds
```

- [ ] **Step 2: Run** — all FAIL.
- [ ] **Step 3: Implement** in `cmd_fold` only, on the clean-complete path (after `_self_checks`, before the final `print`), inside a `try/except Exception` that appends a `shadow-skipped` event with `reason` on ANY failure (Global Constraint: the weave must never break a wave):
  1. `manifest = load_weave_manifest(Path(args.run_dir))`; if `None` → return (no event, no file).
  2. Seed set: paths where the manifest entry's `visibleSha` equals `git rev-parse <base_sha>:<path>` (batch via one `git ls-tree -r <base_sha>` read). Manifest paths touched by this wave whose shas mismatch → one `drift` event each. Empty seed set → done.
  3. Build the seeded base: re-run `rw.snapshot_scoped(repo, base_sha, touched)`, then for each seed path replace `base.files[p]` with the blob's state string (read from `blobs/<stateBlob>`; sha256-verify, mismatch → `drift`). Re-derive task states via `rw.publish` against the seeded base — identical call shape to `_prepare`.
  4. Shadow fold: `eng2 = ff.FrontierEngine(seeded_base)`; fold every task state in argv order in memory. If the shadow narrates any conflict (the fresh pass was clean by construction here) → that IS a divergence: emit `divergence` with `paths` = the conflicting paths.
  5. Else compare visible trees: per path union of both engines' manifests, sha256 over the sorted `(path, "\n".join(lines))` pairs for fresh vs seeded. Equal → one `seeded` event per seed path; different → one `divergence` event carrying both tree sha256s.
  6. Waves that complete via `cmd_resolve` (a conflicted fold) get one `shadow-skipped` event (`reason: "wave completed via resolve"`), appended at `cmd_resolve`'s completion site — the shadow only measures clean folds this tier.
- [ ] **Step 4: Run** the new tests + `tests/test_fold_wave.py` — green. Then the corpus check: `python3 evals/frontier/replay_corpus.py --repo . --corpus evals/frontier/corpus --out /tmp/replay-post-shadow.json` and verify the summary matches the committed GO record (57 rehydratable folds, zero class-2) — the shadow must not have moved the replayer.
- [ ] **Step 5: Commit** — `git commit -m "kernel: shadow seeding + divergence record (Tier 1, map #360)"`

### Task 3: the engine emits on adopt

**Type:** implementation
**Depends-on:** 1
**Review:** adversarial

**Files:**
- Modify: `fleet/run-engine.mjs`
- Test: `fleet/tests/test_weave_emit.mjs`

**Interfaces:**
- Consumes: `emit-weave` argv (Task 1); `foldWave`'s `runCli`/`common`/`blocked` locals and both MERGED return sites (`fleet/run-engine.mjs:846-858` green-first, `:895-905` post-reconcile).
- Produces: engine behavior — after every wave adoption, `emit-weave` runs with the adopted head; its failure is a `judgmentCalls` note, never a wave status.

- [ ] **Step 1: Write the failing sim** `fleet/tests/test_weave_emit.mjs`, following the harness conventions of `fleet/tests/test_run_engine.mjs` (stubbed kernel CLI + stubbed agent; end with the `ALL TESTS PASSED` sentinel — `tests/test_fleet_suite.py` bridges on it). Assertions: (a) on a 2-wave happy-path run, the recorded kernel argv sequence contains `emit-weave` with `--wave 1 --adopt-head <wave1 head>` after wave 1's adopt and `--wave 2 --adopt-head <wave2 head>` after wave 2's; (b) when the stub makes `emit-weave` exit 2, the run still completes and `report.judgmentCalls` carries one entry containing `emit-weave`; (c) on a TEST_FAILED wave (stub suite red, reconcile declines), NO `emit-weave` call is recorded for that wave.
- [ ] **Step 2: Run** — `node fleet/tests/test_weave_emit.mjs` — FAIL.
- [ ] **Step 3: Implement** in `foldWave`: extract one helper inside the function and call it at BOTH adopted-return sites, with the head each site already has (`candidate` at the green-first site, `headSha` at the post-reconcile site), before the `return`:

```js
const emitWeave = async (headSha) => {
  const r = await runCli(['emit-weave', ...common, '--adopt-head', headSha])
  if (r.code !== 0) judgmentCalls.push('wave ' + waveNumber +
    ': emit-weave failed (exit ' + r.code + ') — weave persistence skipped, fold unaffected')
}
```
- [ ] **Step 4: Run** the sim + `python3 -m pytest tests/test_fleet_suite.py -q` — green.
- [ ] **Step 5: Commit** — `git commit -m "engine: emit-weave after every wave adoption (Tier 1)"`

### Task 4: cross-wave validation — the deterministic 2-wave cell

**Type:** implementation
**Depends-on:** 1, 2

**Files:**
- Create: `tests/test_weave_crosswave.py`

**Interfaces:**
- Consumes: the full CLI cycle (`fold` → `materialize` → `emit-weave`, Tasks 1–2) and the sidecar vocabulary (Task 2).

**Parallelization rationale:** validation is a pure consumer of Tasks 1–2's published CLI contract — it builds against the interfaces, not the implementations, so it authors in the same wave as nothing and lands as soon as they do.

- [ ] **Step 1: Write the test** — this is the spec §6 validation in deterministic form (the operator-chosen "local 2-wave cell", with handcrafted patches instead of LLM workers, so it runs in CI forever): a temp git repo; wave 1 = two tasks editing disjoint regions of one `app.py` (patches built with `git diff` in throwaway clones); `fold` → assert complete → `materialize` → commit candidate → `emit-weave`; wave 2 = one task editing near wave 1's edits, based at the adopt head; `fold` → assert complete, then assert the sidecar shows ≥1 `seeded` event, zero `drift`, zero `divergence`, and the wave-2 `manifest.json` has `"wave": 2` with a fresh `visibleSha` matching `git rev-parse <wave2 candidate>:app.py` after its own `emit-weave`.
- [ ] **Step 2: Run** — green against Tasks 1–2 (this task's test is the acceptance instrument; it must pass, not fail, at authoring time — the failing-first cycle lives in Tasks 1–2).
- [ ] **Step 3: Commit** — `git commit -m "tests: deterministic 2-wave weave-persistence cell (spec §6)"`

### Task 5: delete the serialize authoring prose

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/references/dependency-analysis.md`
- Test: `tests/test_serialize_prose_deleted.py`

- [ ] **Step 0: Write the pinning test** `tests/test_serialize_prose_deleted.py` — the deletion's durable regression pin (the precedent is `test_marker_contract.py` pinning the absence of deleted edge tiers):

```python
from pathlib import Path

DOC = Path(__file__).resolve().parents[1] / "skills/ultrapowers/references/dependency-analysis.md"

def test_serialize_is_a_knob_mention_not_authoring_doctrine():
    text = DOC.read_text()
    assert text.count("serialize") <= 2
    for retired in ("serialize the scaffolding task",
                    "do not assume it is safe to write concurrently",
                    "write-after-write"):
        assert retired not in text.lower().replace("'", "")
```
Run it first — FAIL against the undeleted doc.
- [ ] **Step 1: Delete, per the 2026-09-01 inventory** (spec §4.1): the serialize clause in the reads bullet (line ~18), the "still fully supported, described throughout" clause (~36), rule 3's write-after-write serialize choreography (~71, keep the fold half), the serialize-only precedence rules (~77–79), the two conservative defaults at ~102–105 ("serialize the scaffolding task", "do not assume it is safe to write concurrently"), and the serialize byte-identity discussion inside §Small-Plan Degrade (~121–131, keep the 1-task degrade rule). Where a sentence's fold half survives, keep it grammatical. Add ONE line where the knob is first mentioned: "`--overlap serialize` remains as the measured-rollback knob; it is not an authoring consideration."
- [ ] **Step 2: Verify** — `grep -c "serialize" skills/ultrapowers/references/dependency-analysis.md` returns ≤2 (the knob line + at most one flag reference); `python3 -m pytest tests/test_marker_compiler.py tests/test_compile_overlap.py -q` green (the knob's behavior tests are untouched).
- [ ] **Step 3: Commit** — `git commit -m "ultraplan: delete serialize authoring prose — class retired by measurement (#360 sitting 3)"`

### Task 6: dedupe the anti-workaround doctrine + delete the pinned resolver passage

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `skills/ultraplan/SKILL.md`
- Modify: `skills/ultrapowers/references/plan-markers.md`
- Modify: `tests/test_ultraplan_skill.py`

- [ ] **Step 1: Edit `skills/ultraplan/SKILL.md`:** in move 3, keep the imperatives (Files: required; Commutes rules; the non-text `Depends-on` exception; #233 blast radius) and delete the argumentation sentences ("Three old workarounds are authoring **defects**: splitting a feature or a file to dodge a collision; chaining a fan of independent tasks to serialize writers; adding `Depends-on` for file overlap alone."). In the self-review section, delete the clause "and no task shape exists only to dodge a same-file collision (no unnatural split, no chain-for-a-fan, no overlap-only `Depends-on`)". Delete the whole "**Author for the resolver.**" paragraph (operator decision, spec §5.2).
- [ ] **Step 2: Lockstep test edit** in `tests/test_ultraplan_skill.py`: in `test_ultraplan_carries_the_commutes_and_resolver_doctrine`, remove the `"author for the resolver"` assertion (and rename the test to `test_ultraplan_carries_the_commutes_doctrine`); leave every other pinned string in place.
- [ ] **Step 3: Edit `skills/ultrapowers/references/plan-markers.md`** authoring rules (~261–269): this is the ONE surviving copy of the doctrine — keep its imperative sentences, delete only sentences duplicating the argumentation removed from SKILL.md (`test_marker_contract.py` pins `worktree-pure`/`additive`/`fence-aware` etc. — do not touch pinned vocabulary; run the test before committing).
- [ ] **Step 4: Verify** — `python3 -m pytest tests/test_ultraplan_skill.py tests/test_marker_contract.py tests/test_recommendation_rubric.py -q` green; report the net word delta of each file in the commit body (expected ≈ −90 SKILL.md, ≈ −40 plan-markers.md).
- [ ] **Step 5: Commit** — `git commit -m "ultraplan: dedupe contention doctrine, delete resolver choreography — measured license (#360 sitting 3)"`

### Task 7: delete the dead Workflow-era rationale block

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/references/design-rationale.md`
- Test: `tests/test_workflow_rationale_deleted.py`

- [ ] **Step 0: Write the pinning test** `tests/test_workflow_rationale_deleted.py`:

```python
from pathlib import Path

DOC = Path(__file__).resolve().parents[1] / "skills/ultrapowers/references/design-rationale.md"

def test_workflow_era_rationale_is_gone():
    text = DOC.read_text().lower()
    for dead in ("ultracode", "harness", "saved workflow", ".claude/workflows"):
        assert dead not in text
```
Run it first — FAIL against the undeleted doc.
- [ ] **Step 1: Delete** §Step 4 and §Step 4a (lines ~9–62, ~465 words: `ultracode` keyword, write-side harnesses, saved-workflow registry — machinery deleted at 0.3.0). Leave a one-line tombstone under the nearest surviving heading: "Workflow-runtime rationale removed 2026-09-01 — that runtime was deleted at 0.3.0 (#434); see git history."
- [ ] **Step 2: Verify** — `grep -ci "ultracode\|harness" skills/ultrapowers/references/design-rationale.md` returns 0; full suite green.
- [ ] **Step 3: Commit** (own commit — this deletion rides the 0.3.0 cutover license, #403/#386, not the kernel measurement) — `git commit -m "docs: delete Workflow-era design rationale — machinery deleted at 0.3.0 (#403/#386)"`

### Task 8: Full-suite verification

**Type:** gate

**Files:** none

- [ ] Run `python3 -m pytest` from the repo root and confirm every test passes, including the three new weave test files and the edited prose pins.

## Operator smoke

- do: `python3 -m pytest tests/test_weave_crosswave.py -v`
- see: the 2-wave cell passes, naming a `seeded` event and zero divergences in its output.
- do: `grep -rn "serialize the scaffolding" skills/`
- see: no matches — the conservative-default steering prose is gone.
- do: open `skills/ultraplan/SKILL.md` and search "Author for the resolver"
- see: absent; move 3 still states the Commutes and #233 obligations.
- do: after the next real fleet run, `tar -tzf` its evidence bundle
- see: `frontier/weave/manifest.json` and `weave-events.jsonl` present in the run dir.
