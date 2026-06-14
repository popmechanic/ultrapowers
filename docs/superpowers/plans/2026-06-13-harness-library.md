# Harness Library and Ratchet — Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Acceptance:** suite — engine restructuring; verified by the committed test suite (sim, drift, probe, new registry-integrity test) + adversarial review, not a held-out exam.

**Goal:** Evolve the single frozen `workflow.js` into a *library* of frozen harnesses with per-harness manifests, a codified read/write boundary, and a documented born-dynamic-then-frozen ratchet — without changing engine behavior.

**Architecture:** Relocate `workflow.js` → `harnesses/waves.js` and `probe.js` → `harnesses/probe.js` (byte-identical engine content; only paths and the per-launch install change). Each harness gets a sibling `<name>.harness.json` manifest discovered by glob (NOT a single `registry.json` — a shared registry file is a conflict magnet every future harness would serialize on; per-harness manifests let new harnesses land without touching a shared file). A registry-integrity test pins the contract; SKILL.md gains a glob-based install step, the normative read/write boundary, and a ratchet reference. No new harnesses ship in this phase — the docket's `docket-run` (part 3) is the ratchet's first exercise.

**Tech Stack:** JS engine (unchanged), python3 + pytest, the existing anti-drift / sim / probe tests.

**Spec:** `docs/superpowers/specs/2026-06-12-harness-library-design.md` (note: this plan supersedes the spec's single-`registry.json` design with per-harness manifests, per the architecture-for-agents discussion; same information, no shared-file conflict magnet).

**Shared contract (each task restates what it needs):**
- Harness manifest: `skills/ultrapowers/harnesses/<name>.harness.json` =
  `{ "name", "file", "purpose", "writeSide": bool, "version", "fixtures", "driftTest": <path|null> }`.
  `name` must equal the harness JS's `meta.name`. `file` is the basename within `harnesses/`.
- Launch resolution is unchanged: the Workflow tool resolves a saved workflow by its JS `meta.name`, not by installed filename. `waves.js` keeps `meta.name === 'ultrapowers'`; `probe.js` keeps `meta.name === 'ultrapowers-probe'`. So relocating the files does not change how runs launch.
- Read/write boundary: write-side phases (anything that mutates a repo) run a registry harness by `meta.name`; read-only phases may be improvised dynamic workflows and must stay read-only.

---

### Task 1: Relocate the engine into a manifest-described library

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/workflow.js`
- Modify: `skills/ultrapowers/probe.js`
- Create: `skills/ultrapowers/harnesses/waves.js`
- Create: `skills/ultrapowers/harnesses/probe.js`
- Create: `skills/ultrapowers/harnesses/waves.harness.json`
- Create: `skills/ultrapowers/harnesses/probe.harness.json`
- Create: `skills/ultrapowers/harnesses/candidates/.gitkeep`
- Create: `tests/test_harness_registry.py`
- Modify: `tests/sim_workflow.mjs`
- Modify: `tests/test_no_prompt_drift.py`
- Modify: `tests/test_probe.py`
- Modify: `tests/test_canary.py`
- Modify: `tests/test_report_runbook.py`
- Modify: `tests/test_orchestrator_markers.py`
- Modify: `tests/test_superpowers_compat.py`
- Modify: `tests/test_ultraplan_skill.py`
- Modify: `tests/test_workflow_sim.py`
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Modify: `skills/ultrapowers/scripts/audit_run.py`
- Modify: `skills/ultrapowers/SKILL.md`
- Modify: `skills/ultrapowers/references/reviewer-prompts.md`
- Modify: `skills/ultrapowers/references/wave-merge.md`
- Modify: `skills/ultrapowers/references/workflow-template.md`
- Modify: `skills/ultrapowers/viewer/README.md`

(The two `Modify:` engine paths above are relocated by `git mv` in Step 3 — naming both the old paths and the new `Create:` paths keeps every path the task touches inside its declared FILES so the scope guard does not flag the move. The `grep -rln` sweep in Step 5 is the authoritative list of which of the remaining files actually contain a path reference; a listed file with no hit is simply left untouched.)

This is one atomic task: the engine cannot be half-moved and still pass tests (the drift test and sim read it by path). Content of the two engine files must not change — only their location. The SKILL.md install step (Step 4a) is rewritten here to glob manifests so the repo is never left pointing at a moved file.

- [ ] **Step 1: Write the failing registry-integrity test**

Create `tests/test_harness_registry.py`:

```python
"""The harness library contract: every manifest names a real harness file whose
meta.name matches, with existing fixtures and (optional) drift test. Candidates
are not registered. No execution — meta.name is read by regex, like the drift
test does."""
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
HARNESSES = ROOT / "skills/ultrapowers/harnesses"


def manifests():
    return sorted(HARNESSES.glob("*.harness.json"))


def meta_name(js_path):
    text = js_path.read_text()
    m = re.search(r"meta\s*=\s*\{.*?name:\s*'([^']+)'", text, re.S)
    return m.group(1) if m else None


def test_at_least_the_two_core_harnesses_registered():
    names = {json.loads(m.read_text())["name"] for m in manifests()}
    assert {"ultrapowers", "ultrapowers-probe"} <= names


def test_every_manifest_points_to_a_matching_harness():
    for m in manifests():
        spec = json.loads(m.read_text())
        for key in ("name", "file", "purpose", "writeSide", "version", "fixtures", "driftTest"):
            assert key in spec, f"{m.name}: missing key {key}"
        js = HARNESSES / spec["file"]
        assert js.exists(), f"{m.name}: harness file {spec['file']} missing"
        assert meta_name(js) == spec["name"], f"{m.name}: meta.name != manifest name"
        assert (ROOT / spec["fixtures"]).exists(), f"{m.name}: fixtures path missing"
        if spec["driftTest"] is not None:
            assert (ROOT / spec["driftTest"]).exists(), f"{m.name}: driftTest path missing"


def test_candidates_are_not_registered():
    cand = HARNESSES / "candidates"
    assert cand.is_dir(), "candidates/ directory must exist (ratchet staging)"
    assert not list(cand.glob("*.harness.json")), "candidates must not carry registered manifests"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m pytest tests/test_harness_registry.py -q`
Expected: FAIL — `skills/ultrapowers/harnesses/` does not exist yet.

- [ ] **Step 3: Move the engine files (content unchanged)**

```bash
mkdir -p skills/ultrapowers/harnesses/candidates
git mv skills/ultrapowers/workflow.js skills/ultrapowers/harnesses/waves.js
git mv skills/ultrapowers/probe.js skills/ultrapowers/harnesses/probe.js
touch skills/ultrapowers/harnesses/candidates/.gitkeep
```

Do not edit the contents of `waves.js` or `probe.js`. (Verify after: `git show HEAD:skills/ultrapowers/workflow.js | diff - skills/ultrapowers/harnesses/waves.js` must be empty.)

- [ ] **Step 4: Write the two manifests**

Create `skills/ultrapowers/harnesses/waves.harness.json` (set `version` to the current value in `skills/ultrapowers/plugin.json` or the repo's plugin manifest — read it; do not invent):

```json
{
  "name": "ultrapowers",
  "file": "waves.js",
  "purpose": "plan -> parallel waves -> independent review -> merge",
  "writeSide": true,
  "version": "0.0.8",
  "fixtures": "tests/test_workflow_sim.py",
  "driftTest": "tests/test_no_prompt_drift.py"
}
```

Create `skills/ultrapowers/harnesses/probe.harness.json`:

```json
{
  "name": "ultrapowers-probe",
  "file": "probe.js",
  "purpose": "zero-agent engine preflight",
  "writeSide": false,
  "version": "0.0.8",
  "fixtures": "tests/test_probe.py",
  "driftTest": null
}
```

- [ ] **Step 5: Update every path reference**

Find them: `grep -rln "ultrapowers/workflow.js\|ultrapowers/probe.js" tests/ skills/`. For each hit, repoint the path:
- `skills/ultrapowers/workflow.js` → `skills/ultrapowers/harnesses/waves.js`
- `skills/ultrapowers/probe.js` → `skills/ultrapowers/harnesses/probe.js`

Key load-bearing spots to verify by hand after the sweep:
- `tests/sim_workflow.mjs`: `new URL('../skills/ultrapowers/workflow.js', ...)` → `'../skills/ultrapowers/harnesses/waves.js'`.
- `tests/test_no_prompt_drift.py`: `WORKFLOW = ROOT / "skills/ultrapowers/workflow.js"` → `".../harnesses/waves.js"`.
- `tests/test_probe.py`: any probe.js path → `harnesses/probe.js`.
- Prose mentions in `references/*.md`, `scripts/*.py` comments, `viewer/README.md`: update for accuracy (these do not affect tests but must not lie).

- [ ] **Step 6: Rewrite the SKILL.md install step (Step 4a) to glob manifests**

In `skills/ultrapowers/SKILL.md`, replace the Step 4a copy block (currently the `mkdir -p .claude/workflows` + two `cp` lines) with a manifest-driven loop:

```bash
mkdir -p .claude/workflows
for m in "${CLAUDE_PLUGIN_ROOT}"/skills/ultrapowers/harnesses/*.harness.json; do
  f=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['file'])" "$m")
  cp "${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/harnesses/$f" ".claude/workflows/$f"
done
```

Update the surrounding prose: harnesses are copied from `skills/ultrapowers/harnesses/` by manifest; launch is still by `meta.name` (`ultrapowers` for the waves harness, `ultrapowers-probe` for the probe), so the installed filename is immaterial. Update the Step 4b note that currently says "the installed filename (`ultrapowers-run.js`)" to reflect the new install names (`waves.js` / `probe.js`) while keeping the load-bearing point that resolution is by `meta.name`.

- [ ] **Step 7: Verify content unchanged + suite green**

Run, in order:
```bash
git show HEAD:skills/ultrapowers/workflow.js | diff - skills/ultrapowers/harnesses/waves.js && echo "waves.js identical"
git show HEAD:skills/ultrapowers/probe.js | diff - skills/ultrapowers/harnesses/probe.js && echo "probe.js identical"
node tests/sim_workflow.mjs
python3 -m pytest tests/ -q
python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers
```
Expected: both diffs empty, sim prints `ALL SCENARIOS PASSED`, full suite green (incl. `test_harness_registry.py`), validator prints `skill ok`.

- [ ] **Step 8: Commit**

```bash
git add -A skills/ultrapowers tests/
git commit -m "refactor: relocate engine into harnesses/ library with per-harness manifests"
```

---

### Task 2: Codify the read/write boundary and the ratchet

**Type:** implementation
**Depends-on:** 1

**Files:**
- Modify: `skills/ultrapowers/SKILL.md`
- Create: `skills/ultrapowers/references/harness-ratchet.md`

Depends on Task 1: this edits `SKILL.md` (serialized after Task 1's SKILL.md edits) and references the manifest paths Task 1 creates. NEVER edit the harness JS files here.

- [ ] **Step 1: Add the read/write boundary section to SKILL.md**

In `skills/ultrapowers/SKILL.md`, after the determinism-guard note in Step 4, add a normative section:

```markdown
## The read/write boundary

ultrapowers runs two kinds of phase, and they have different rules:

- **Write-side phases** — anything that creates branches, edits files, merges,
  or otherwise mutates a repository — MUST be executed by a registry harness
  (a `skills/ultrapowers/harnesses/<name>.harness.json` whose `writeSide` is
  true), launched by its `meta.name`. Never author or improvise a write-side
  harness at runtime.
- **Read-only phases** — discovery, triage, research, scoring — MAY be
  improvised at runtime as dynamic workflows, and an improvised workflow MUST
  stay read-only.

This is policy enforced by prompts and review, not a sandbox; the hard
guarantee is that nothing improvised ever holds the merge keys. The
determinism guard restated: never launch write-side work via the `ultracode`
keyword or a prose "make me a workflow" request — that authors a new script at
runtime, which is exactly the nondeterminism the registry exists to remove.
```

- [ ] **Step 2: Write the ratchet reference**

Create `skills/ultrapowers/references/harness-ratchet.md`:

```markdown
# The harness ratchet

New harness topologies are *born dynamic* and *live frozen*. The promotion
path, modeled on how `waves.js` itself was built, debugged, and pinned:

1. **Born dynamic.** Prototype the topology as an improvised dynamic workflow,
   confined to read-only work or to fixture repositories. Nothing real is
   mutated.
2. **Candidate.** Commit the prototype under
   `skills/ultrapowers/harnesses/candidates/<name>.js` with a fixture suite and
   an args-validation preflight (the probe pattern). A candidate is launchable
   ONLY against fixture repositories; it carries no `<name>.harness.json`
   manifest, so the registry-integrity test treats it as unregistered.
3. **Promotion.** A candidate becomes a registered harness only when ALL hold:
   fixture end-to-end run green; a prompt-pinning (drift) test added if it bakes
   any discipline; args contract documented; the harness source reviewed by a
   human; and a `<name>.harness.json` manifest added. Promotion is a normal
   reviewed commit.
4. **Life.** A registered harness changes only via the same review + re-pin
   procedure — the re-bake discipline, generalized to the whole library.

The registry-integrity test (`tests/test_harness_registry.py`) enforces the
structural half: every manifest names a real harness whose `meta.name` matches,
with existing fixtures and drift test, and no candidate carries a manifest.
```

- [ ] **Step 3: Validate**

Run: `python3 -m pytest tests/ -q && python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers`
Expected: green; `skill ok` (the new `references/harness-ratchet.md` is referenced from SKILL.md, so validate_skill's reference-integrity check passes). If `tests/test_ultraplan_skill.py` or another test pins SKILL.md section lists, extend the pins — never weaken an assertion.

- [ ] **Step 4: Commit**

```bash
git add skills/ultrapowers/SKILL.md skills/ultrapowers/references/harness-ratchet.md
git commit -m "docs: codify the read/write boundary and the harness ratchet"
```

---

### Task 3: Full-suite verification

**Type:** gate
**Depends-on:** 1, 2

Run: `python3 -m pytest tests/ -q`
Expected: every test passes — including `test_harness_registry.py`, the relocated sim/drift/probe tests at their new paths, and `test_all_plans_compile.py`. Also: `node tests/sim_workflow.mjs` prints `ALL SCENARIOS PASSED`, and `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers` prints `skill ok`.

---

## Self-review notes

- Spec coverage: library layout + per-harness manifests (Task 1, superseding the spec's `registry.json` with the conflict-magnet-free variant), glob install (Task 1 Step 6), read/write boundary + determinism guard (Task 2 Step 1), ratchet doc (Task 2 Step 2), registry-integrity test (Task 1 Step 1), byte-identical migration (Task 1 Steps 3/7). No new harnesses — the spec's explicit non-goal — honored.
- Type consistency: the manifest shape `{name, file, purpose, writeSide, version, fixtures, driftTest}` defined in Task 1 is the exact shape the integrity test (Task 1) and the ratchet doc (Task 2) describe.
- Collision handling: Tasks 1 and 2 both edit `SKILL.md`; the `**Depends-on:** 1` on Task 2 serializes them (write-after-write), so they merge in order, never concurrently. Task 1 is otherwise atomic by necessity (the engine cannot be half-relocated with tests green).
- Execution note for the operator: after this merges, the launch ritual changes — Step 4a now globs `harnesses/*.harness.json` and copies each by basename (`waves.js`, `probe.js`); launch remains by `meta.name`. The part-3 docket plan's `docket-run` harness is the ratchet's first real promotion and assumes this library exists.
