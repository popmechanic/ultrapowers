# ultrapowers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Note: ultrapowers does not exist yet, so this plan is built with Superpowers' own executor (bootstrapping). Once shipped, future plans could be executed by `ultrapowers:ultra-driven-development`.

**Goal:** Ship the `ultrapowers` Claude Code plugin — a single skill, `ultra-driven-development`, that autonomously executes an approved Superpowers plan via a parallel, worktree-isolated Dynamic Workflow with adversarial verification, depending on (never forking) `superpowers`.

**Architecture:** A skill-only plugin (auto-discovered `skills/` layout, lean `SKILL.md` + progressive-disclosure `references/`). The `SKILL.md` instructs the *main* agent to: load Superpowers discipline via the Skill tool, infer a task DAG from the plan and group it into waves, author and launch a Dynamic Workflow (each task agent in a git worktree), then present a single pre-merge review. Detailed mechanics live in `references/`; a Python validator and a canary fixture provide the test surface.

**Tech Stack:** Claude Code plugin format (`.claude-plugin/plugin.json`, `skills/<name>/SKILL.md`), Dynamic Workflows (the Workflow tool), `superpowers` skills (soft dependency), Python 3 + pytest (validator + tests), git worktrees.

**Spec:** `docs/superpowers/specs/2026-06-02-ultrapowers-design.md`

---

## File Structure

```
ultrapowers/
├── .claude-plugin/
│   ├── plugin.json                  # manifest: name only required; skills auto-discovered
│   └── marketplace.json             # single-plugin marketplace, source "."
├── README.md                        # purpose + superpowers co-install requirement
├── .gitignore
├── skills/
│   └── ultra-driven-development/
│       ├── SKILL.md                 # lean orchestrator (~1.5–2k words, imperative)
│       ├── references/
│       │   ├── dependency-analysis.md   # plan → DAG → waves; conservative defaults; degrade threshold
│       │   ├── workflow-template.md     # the Dynamic Workflow skeleton to adapt at runtime
│       │   ├── reviewer-prompts.md      # baked implementer + spec + quality prompts & JSON schemas
│       │   ├── wave-merge.md            # wave-barrier merge, reconciliation, integration/completeness review
│       │   └── report-format.md         # structured pre-merge report schema
│       └── scripts/
│           └── validate_skill.py        # frontmatter + reference-integrity validator
├── tests/
│   ├── test_validate_skill.py
│   └── fixtures/
│       ├── canary-plan.md               # tiny plan: 2 independent + 1 dependent task
│       └── good-skill/SKILL.md          # minimal valid skill for validator tests
└── docs/superpowers/
    ├── specs/2026-06-02-ultrapowers-design.md          # exists
    └── plans/2026-06-02-ultrapowers-implementation.md  # this file
```

Responsibilities are split one-per-file: each `references/` file owns one mechanic so the runtime agent loads only what it needs (progressive disclosure), and so each build task is self-contained.

---

### Task 1: De-risk spike — prove the core integration bet

The spec's three highest-priority unknowns: (a) a `SKILL.md` can drive `Workflow`, (b) a workflow `agent()` can run in an isolated git worktree and have its change merged, (c) the wave/merge loop is viable. Prove these with a throwaway spike **before** investing in the full plugin. Spike artifacts live in `/tmp/ultrapowers-spike`, are **not** committed to the plugin.

**Files:**
- Create (scratch, not committed): `/tmp/ultrapowers-spike/wf.js`, `/tmp/ultrapowers-spike/notes.md`

- [ ] **Step 1: Init a scratch git repo with a trivial file**

```bash
mkdir -p /tmp/ultrapowers-spike && cd /tmp/ultrapowers-spike
git init -q && printf 'line1\nline2\n' > target.txt
git add -A && git -c user.email=s@s -c user.name=s commit -q -m "init"
```

- [ ] **Step 2: Hand-author a minimal workflow that edits a file inside a worktree agent**

`/tmp/ultrapowers-spike/wf.js`:

```javascript
export const meta = {
  name: 'spike-worktree-edit',
  description: 'Prove a workflow agent can edit in an isolated worktree',
  phases: [{ title: 'Edit' }],
}
phase('Edit')
const r = await agent(
  'In the current working directory, append the line "spike-ok" to target.txt, then stop. Report the final contents of target.txt.',
  { label: 'spike-editor', isolation: 'worktree' }
)
return { report: r }
```

- [ ] **Step 3: Run the workflow via the Workflow tool and confirm it completes**

Invoke `Workflow({ scriptPath: "/tmp/ultrapowers-spike/wf.js" })`.
Expected: workflow returns a `report`; the agent ran in a worktree; the change is present on the agent's worktree branch. Record in `notes.md` whether the worktree was auto-created and how its branch relates to the scratch repo.

- [ ] **Step 4: Confirm a SKILL.md instruction can launch a workflow**

Create a throwaway local skill (`/tmp/ultrapowers-spike/skills/spike/SKILL.md`) whose body says: "Invoke the Workflow tool with scriptPath /tmp/ultrapowers-spike/wf.js and report the result." Load it with `claude --plugin-dir` (or `--plugin-dir /tmp/ultrapowers-spike` if wrapped as a plugin) and confirm invoking the skill causes a `Workflow` call. Record the exact invocation ergonomics in `notes.md`.

- [ ] **Step 5: GATE — decide go / no-go**

If all of (a)(b)(c) hold, proceed. If any fails, STOP and revise the spec (do not continue building). Record the verdict and any required design changes in `notes.md` and surface them to the human.

- [ ] **Step 6: No commit** (spike is scratch; nothing enters the plugin repo)

---

### Task 2: Plugin scaffold

**Files:**
- Create: `.claude-plugin/plugin.json`
- Create: `.claude-plugin/marketplace.json`
- Create: `README.md`
- Create: `.gitignore`

- [ ] **Step 1: Write `.claude-plugin/plugin.json`** (only `name` is strictly required; skills auto-discover from `skills/` — no `components` field, no hook needed)

```json
{
  "name": "ultrapowers",
  "version": "0.1.0",
  "description": "Autonomous, parallel, worktree-isolated execution of Superpowers plans via Dynamic Workflows. Pairs with superpowers; replaces subagent-driven-development with ultra-driven-development.",
  "author": { "name": "Marcus Estes", "email": "marcus@vibes.diy" },
  "homepage": "https://github.com/popmechanic/ultrapowers",
  "repository": "https://github.com/popmechanic/ultrapowers",
  "license": "MIT",
  "keywords": ["skills", "workflows", "superpowers", "parallel", "worktrees", "ultracode"]
}
```

- [ ] **Step 2: Write `.claude-plugin/marketplace.json`** (repo itself is the marketplace root → `source: "."`)

```json
{
  "name": "ultrapowers",
  "owner": { "name": "Marcus Estes", "email": "marcus@vibes.diy" },
  "description": "ultrapowers: autonomous parallel execution for Superpowers plans.",
  "plugins": [
    { "name": "ultrapowers", "source": ".", "description": "ultra-driven-development executor", "version": "0.1.0" }
  ]
}
```

- [ ] **Step 3: Write `.gitignore`**

```
__pycache__/
*.pyc
.pytest_cache/
.DS_Store
```

- [ ] **Step 4: Write `README.md`** with these required sections (concrete content, no placeholders):
  - **Title + one-line:** "ultrapowers — Superpowers' discipline, ultracode's parallel engine."
  - **What it is:** one skill, `ultra-driven-development`, the autonomous parallel drop-in for `superpowers:subagent-driven-development`.
  - **Relationship to superpowers** (verbatim intent): "This plugin depends on `superpowers`. Install superpowers alongside ultrapowers — ultrapowers reuses its brainstorming, writing-plans, TDD, code-review, verification, and finishing-a-development-branch skills and does not duplicate them."
  - **Install:** `/plugin marketplace add popmechanic/ultrapowers` then `/plugin install ultrapowers@ultrapowers`.
  - **Usage:** brainstorm → writing-plans (approve plan) → `ultrapowers:ultra-driven-development` → review the integration branch + report → finishing-a-development-branch.
  - **Human gates:** plan approval and pre-merge review only; execution is autonomous.
  - **Cost note:** parallel + adversarial verification + worktrees is token-heavy; small plans auto-degrade to sequential.

- [ ] **Step 5: Verify the plugin loads and the skill is discovered**

Run: `claude --plugin-dir ~/Websites/ultrapowers` (in a throwaway session) and confirm `ultrapowers:ultra-driven-development` does not yet appear (SKILL.md not built) but the manifest parses without error. Validate JSON:

Run: `python3 -c "import json,sys; [json.load(open(p)) for p in ['.claude-plugin/plugin.json','.claude-plugin/marketplace.json']]; print('json ok')"`
Expected: `json ok`

- [ ] **Step 6: Commit**

```bash
git add .claude-plugin README.md .gitignore
git commit -m "feat: ultrapowers plugin scaffold (manifest, marketplace, README)"
```

---

### Task 3: Skill validator (`validate_skill.py`) — TDD

A small, dependency-free validator used by tests and by a future maintainer. Checks: SKILL.md has YAML frontmatter with `name` + `description`; description is non-trivial; every `references/<file>.md` mentioned in the body actually exists.

**Files:**
- Create: `tests/fixtures/good-skill/SKILL.md`
- Create: `tests/test_validate_skill.py`
- Create: `skills/ultra-driven-development/scripts/validate_skill.py`

- [ ] **Step 1: Write the good fixture skill**

`tests/fixtures/good-skill/SKILL.md`:

```markdown
---
name: good-skill
description: This skill should be used when the user asks to "do the good thing". Demonstrates a valid skill.
---

To do the good thing, follow references/guide.md.
```

And create `tests/fixtures/good-skill/references/guide.md` containing `# Guide`.

- [ ] **Step 2: Write failing tests**

`tests/test_validate_skill.py`:

```python
import subprocess, sys, pathlib, textwrap
ROOT = pathlib.Path(__file__).resolve().parents[1]
VALIDATOR = ROOT / "skills/ultra-driven-development/scripts/validate_skill.py"

def run(skill_dir):
    p = subprocess.run([sys.executable, str(VALIDATOR), str(skill_dir)],
                       capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr

def test_good_skill_passes():
    code, out = run(ROOT / "tests/fixtures/good-skill")
    assert code == 0, out

def test_missing_description_fails(tmp_path):
    (tmp_path / "SKILL.md").write_text("---\nname: x\n---\nbody\n")
    code, out = run(tmp_path)
    assert code != 0 and "description" in out

def test_missing_reference_fails(tmp_path):
    (tmp_path / "SKILL.md").write_text(
        "---\nname: x\ndescription: This skill should be used when ...\n---\n"
        "see references/missing.md\n")
    code, out = run(tmp_path)
    assert code != 0 and "missing.md" in out
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd ~/Websites/ultrapowers && python3 -m pytest tests/test_validate_skill.py -v`
Expected: FAIL (validator file does not exist yet).

- [ ] **Step 4: Implement `validate_skill.py`**

```python
#!/usr/bin/env python3
"""Validate a Claude Code SKILL.md: frontmatter + reference integrity."""
import re, sys, pathlib

def validate(skill_dir: pathlib.Path):
    errors = []
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.exists():
        return [f"{skill_md} not found"]
    text = skill_md.read_text()
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.DOTALL)
    if not m:
        return ["SKILL.md missing YAML frontmatter (--- ... ---)"]
    fm, body = m.group(1), m.group(2)
    fields = dict(re.findall(r"^([A-Za-z0-9_-]+):\s*(.*)$", fm, re.MULTILINE))
    if not fields.get("name"):
        errors.append("frontmatter: missing 'name'")
    desc = fields.get("description", "")
    if len(desc) < 20:
        errors.append("frontmatter: missing or trivial 'description'")
    for ref in re.findall(r"references/([A-Za-z0-9_\-/]+\.md)", body):
        if not (skill_dir / "references" / ref).exists():
            errors.append(f"missing referenced file: references/{ref}")
    return errors

if __name__ == "__main__":
    target = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path.cwd()
    errs = validate(target)
    if errs:
        print("\n".join(errs)); sys.exit(1)
    print("skill ok"); sys.exit(0)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd ~/Websites/ultrapowers && python3 -m pytest tests/test_validate_skill.py -v`
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add skills/ultra-driven-development/scripts/validate_skill.py tests/
git commit -m "feat: SKILL.md validator with tests"
```

---

### Task 4: `references/dependency-analysis.md`

**Files:**
- Create: `skills/ultra-driven-development/references/dependency-analysis.md`

- [ ] **Step 1: Write the file** with these exact sections and concrete substance (imperative form, no second person):
  - **Input:** an approved `superpowers:writing-plans` plan doc (Tasks with **Files:** Create/Modify/Test lists).
  - **Build the DAG:** for each task, collect the set of files it Creates/Modifies. Add edge `A → B` when B Modifies a file A Creates, or when B's text says "depends on Task A" / "after Task A". Treat shared-file writes as a dependency (serialize), not a parallel pair.
  - **Group into waves:** a wave = the maximal set of remaining tasks with no unsatisfied dependency on a task outside earlier waves (topological layering). Emit `waves: Task[][]`.
  - **Conservative defaults:** when file sets are ambiguous or a task's Files list is incomplete, place the task in its own later wave (serialize) rather than risk a concurrent conflict.
  - **Cycle detection:** if the DAG has a cycle, abort to the human with the offending edges (do not guess).
  - **Small-plan degrade:** if total tasks ≤ 2, or every task touches an overlapping file set, collapse to a single sequential wave and skip worktree machinery entirely.
  - **Transparency:** the computed `waves` and the edges that produced them are recorded for inclusion in the final report (see `report-format.md`).

- [ ] **Step 2: Verify** the file exists and is referenced-from-able. Run: `test -f skills/ultra-driven-development/references/dependency-analysis.md && echo ok`. Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add skills/ultra-driven-development/references/dependency-analysis.md
git commit -m "docs: dependency-analysis reference (plan -> DAG -> waves)"
```

---

### Task 5: `references/workflow-template.md`

**Files:**
- Create: `skills/ultra-driven-development/references/workflow-template.md`

- [ ] **Step 1: Write the file.** It contains the Dynamic Workflow skeleton the main agent adapts at runtime, plus notes on how to fill it. Include this concrete skeleton verbatim, with explicit fill-in markers described in prose (not left as silent TODOs):

````markdown
```javascript
export const meta = {
  name: 'ultra-driven-development',
  description: 'Execute an approved plan: parallel waves, worktree isolation, adversarial review',
  phases: [ /* one entry per wave, titled "Wave N" */ ],
}
// WAVES and per-task PROMPTS/SCHEMAS are injected by the main agent at authoring time.
const WAVES = args.waves              // Task[][] from dependency-analysis
const integrationBranch = args.integrationBranch
for (let w = 0; w < WAVES.length; w++) {
  phase(`Wave ${w + 1}`)
  const results = await parallel(WAVES[w].map(task => () =>
    runTask(task)                     // pipeline defined below; barrier per wave
  ))
  await mergeWave(results, integrationBranch)   // see wave-merge.md
}
return await integrationReview(integrationBranch) // see wave-merge.md + report-format.md
```
````

  - **Per-task pipeline (`runTask`):** implement → spec-compliance review → code-quality review → bounded fix-loop, each `agent()` call using `isolation: 'worktree'`, the prompts/schemas from `reviewer-prompts.md`, and `model` tiers per role. Each implementer returns its **worktree branch + HEAD sha** (branch names are runtime-assigned, so the task→branch map comes from the agent).
  - **Merge step (`mergeWave`):** the workflow script cannot run git, so `mergeWave` dispatches a dedicated **non-isolated** merge agent with the wave's reported branches; it merges them into the integration branch (in the main checkout) and runs the tests. See `wave-merge.md`.
  - **Authoring instructions:** the main agent loads the Superpowers discipline (Task content reused from `reviewer-prompts.md`), substitutes real task text (pasted, not file refs), and passes `args = { waves, integrationBranch }` to `Workflow`.
  - **Barrier rationale:** `parallel()` per wave is a deliberate barrier — the wave must fully merge before the next wave starts (cross-wave dependencies). Within a wave, tasks are independent by construction.
  - **Budget guard:** if `budget.total` is set, degrade model tiers / stop early and return a partial report rather than exceeding it.

- [ ] **Step 2: Verify** file exists. Run: `test -f skills/ultra-driven-development/references/workflow-template.md && echo ok`. Expected `ok`.

- [ ] **Step 3: Commit**

```bash
git add skills/ultra-driven-development/references/workflow-template.md
git commit -m "docs: workflow-template reference (wave loop skeleton)"
```

---

### Task 6: `references/reviewer-prompts.md`

**Files:**
- Create: `skills/ultra-driven-development/references/reviewer-prompts.md`

- [ ] **Step 1: Write the file.** It bakes Superpowers' implementer/reviewer discipline into workflow-agent prompts + JSON schemas (so headless agents need no live Skill-tool access). Sections, with concrete content:
  - **Sourcing note:** these prompts are adapted from `superpowers:subagent-driven-development` (implementer, spec-reviewer, code-quality-reviewer) and `superpowers:test-driven-development`/`verification-before-completion`. The main agent loads those skills via the Skill tool at authoring time and refreshes this content if Superpowers has changed.
  - **Implementer prompt:** receives the **full pasted task text**, the worktree path, TDD instruction (red→green→refactor), and the status protocol. Must self-verify before reporting, and must report its **worktree branch** (`git branch --show-current`) and **HEAD sha** (`git rev-parse HEAD`) so the merge step can map task→branch.
  - **Status schema** (verbatim JSON Schema):

```json
{ "type": "object", "required": ["status", "summary", "branch"],
  "properties": {
    "status": { "enum": ["DONE", "DONE_WITH_CONCERNS", "NEEDS_CONTEXT", "BLOCKED"] },
    "summary": { "type": "string" },
    "concerns": { "type": "array", "items": { "type": "string" } },
    "branch": { "type": "string" },
    "headSha": { "type": "string" },
    "commit": { "type": "string" } } }
```

  - **Spec-compliance reviewer prompt:** independent; "verify everything independently, do not trust the implementer report"; checks the diff matches the task (nothing more/less).
  - **Code-quality reviewer prompt:** runs only after spec-compliance passes; separation of concerns, error handling, DRY, test quality.
  - **Verdict schema** (verbatim):

```json
{ "type": "object", "required": ["verdict", "issues"],
  "properties": {
    "verdict": { "enum": ["PASS", "FIX_REQUIRED"] },
    "issues": { "type": "array", "items": { "type": "object",
      "required": ["severity", "detail"],
      "properties": { "severity": { "enum": ["blocking", "minor"] }, "detail": { "type": "string" } } } } } }
```

  - **Fix-loop policy:** on `FIX_REQUIRED`, re-dispatch the implementer with the issues; cap at 3 iterations; on repeated `BLOCKED`, escalate to a more capable model once, then mark the task failed and surface it (never silently drop).
  - **Model tiers:** cheap for mechanical 1–2-file tasks, standard for multi-file integration, most-capable for review/design.

- [ ] **Step 2: Verify** valid JSON in the two schema blocks.

```bash
cd ~/Websites/ultrapowers && python3 - <<'PY'
import re, json, pathlib
t = pathlib.Path('skills/ultra-driven-development/references/reviewer-prompts.md').read_text()
for b in re.findall(r'```json\n(.*?)```', t, re.S):
    json.loads(b)
print('schemas ok')
PY
```
Expected: `schemas ok`.

- [ ] **Step 3: Commit**

```bash
git add skills/ultra-driven-development/references/reviewer-prompts.md
git commit -m "docs: reviewer-prompts reference (baked discipline + schemas)"
```

---

### Task 7: `references/wave-merge.md`

**Files:**
- Create: `skills/ultra-driven-development/references/wave-merge.md`

- [ ] **Step 1: Write the file** with concrete procedures:
  - **Integration branch:** created by an agent (the script can't run git) from the base branch before Wave 1 (`git checkout -b ultra/integration-<timestamp>`; timestamp passed in via `args` since workflows can't call Date.now()).
  - **Worktree/branch facts (spike-confirmed):** task agents run in worktrees at `<repo>/.claude/worktrees/wf_<runId>-<n>` on runtime-assigned branches `worktree-wf_<runId>-<n>`; each implementer self-reports its branch + HEAD sha.
  - **Merge is done by an agent, not the script:** the workflow body has no shell/fs, so `mergeWave` dispatches one **non-isolated** merge agent with the wave's reported branches. That agent merges them into the integration branch (in the main checkout) in deterministic task order, then runs the project's test command (detected from the repo: `pnpm check` / `npm test` / `pytest` / `cargo test` / `go test ./...`).
  - **Reconciliation:** on a merge conflict or a failed post-merge test, dispatch one reconciliation agent with the conflict/diff and the failing output; cap at 2 attempts. If unresolved, mark the wave `blocked`, leave its branches intact, and record it for the report — do not abort the whole run unless a downstream wave wholly depends on the blocked output.
  - **Integration / completeness review (after the final wave):** run the full test suite, then dispatch a completeness-critic agent (reusing `superpowers:verification-before-completion`): "what plan requirement is unmet, what claim is unverified, what path is untested?" Its findings join the report.
  - **No silent caps:** every truncation (fix-loop cap, reconciliation cap, blocked wave) is logged via `log()` and included in the report.

- [ ] **Step 2: Verify** file exists. Run `test -f skills/ultra-driven-development/references/wave-merge.md && echo ok`. Expected `ok`.

- [ ] **Step 3: Commit**

```bash
git add skills/ultra-driven-development/references/wave-merge.md
git commit -m "docs: wave-merge reference (merge, reconciliation, integration review)"
```

---

### Task 8: `references/report-format.md`

**Files:**
- Create: `skills/ultra-driven-development/references/report-format.md`

- [ ] **Step 1: Write the file.** Defines the structured report the workflow returns and the main agent presents at the pre-merge gate. Include this schema verbatim:

```json
{ "type": "object",
  "required": ["integrationBranch", "waves", "tasks", "tests", "unfinished"],
  "properties": {
    "integrationBranch": { "type": "string" },
    "waves": { "type": "array", "items": { "type": "array", "items": { "type": "string" } } },
    "dependencyEdges": { "type": "array", "items": { "type": "string" } },
    "tasks": { "type": "array", "items": { "type": "object",
      "required": ["task", "status"],
      "properties": { "task": {"type":"string"}, "status": {"type":"string"}, "branch": {"type":"string"},
        "commit": {"type":"string"}, "reviewVerdict": {"type":"string"}, "notes": {"type":"string"} } } },
    "tests": { "type": "object", "properties": { "command": {"type":"string"}, "passed": {"type":"boolean"}, "output": {"type":"string"} } },
    "judgmentCalls": { "type": "array", "items": { "type": "string" } },
    "unfinished": { "type": "array", "items": { "type": "string" } },
    "completenessFindings": { "type": "array", "items": { "type": "string" } } } }
```

  - **Presentation:** the main agent renders this as a short human-readable summary (wave plan, per-task status, test result, anything unfinished/judged) plus the integration branch name, then asks the human to approve merge → `superpowers:finishing-a-development-branch`, or to redirect.

- [ ] **Step 2: Verify** the schema is valid JSON (same one-liner pattern as Task 6). Expected: ok.

- [ ] **Step 3: Commit**

```bash
git add skills/ultra-driven-development/references/report-format.md
git commit -m "docs: report-format reference (pre-merge report schema)"
```

---

### Task 9: `SKILL.md` — the lean orchestrator

**Files:**
- Create: `skills/ultra-driven-development/SKILL.md`

- [ ] **Step 1: Write the frontmatter** (third-person, specific triggers; pre-approve the tools it drives):

```yaml
---
name: ultra-driven-development
description: This skill should be used when the user asks to "execute this plan", "go ultra", "run the plan as a workflow", "ultra-driven development", or wants to autonomously implement an approved Superpowers plan in parallel. The drop-in alternative to superpowers:subagent-driven-development.
allowed-tools: Workflow Skill Read Grep Glob Bash Edit Write
---
```

- [ ] **Step 2: Write the body** (imperative form, ~1.5–2k words) covering, in order:
  1. **Precondition:** an approved `superpowers:writing-plans` plan doc exists. If not, stop and point the user to brainstorming/writing-plans.
  2. **Load discipline:** invoke `superpowers:subagent-driven-development`, `superpowers:test-driven-development`, `superpowers:verification-before-completion` via the Skill tool to refresh the implementer/reviewer discipline that gets baked into the workflow.
  3. **Analyze dependencies:** follow `references/dependency-analysis.md` to produce `waves`. If ≤2 tasks or overlapping files, take the sequential degrade path.
  4. **Author the workflow:** follow `references/workflow-template.md`, baking prompts/schemas from `references/reviewer-prompts.md`; pass `args = { waves, integrationBranch }`.
  5. **Launch:** invoke the `Workflow` tool with the authored script. Do not pause mid-run (headless).
  6. **Merge waves & review:** governed inside the workflow per `references/wave-merge.md`.
  7. **Present pre-merge report:** render the `references/report-format.md` structure; ask the human to approve → `superpowers:finishing-a-development-branch`, or redirect.
  - **Autonomy posture:** catastrophe-only escalation; blocked tasks are surfaced in the report, not raised mid-run.
  - **Resource pointers:** list all five `references/` files and `scripts/validate_skill.py`.

- [ ] **Step 3: Verify with the validator**

Run: `cd ~/Websites/ultrapowers && python3 skills/ultra-driven-development/scripts/validate_skill.py skills/ultra-driven-development`
Expected: `skill ok` (all referenced files exist, frontmatter valid).

- [ ] **Step 4: Verify discovery**

Run: `claude --plugin-dir ~/Websites/ultrapowers` (throwaway session); confirm `ultrapowers:ultra-driven-development` is now listed.
Expected: skill present.

- [ ] **Step 5: Commit**

```bash
git add skills/ultra-driven-development/SKILL.md
git commit -m "feat: ultra-driven-development SKILL.md orchestrator"
```

---

### Task 10: Canary — end-to-end dry-run validation

Validate the engine on a tiny fixture without a full real build. The fixture plan has two independent tasks and one dependent task, so the expected wave grouping is known.

**Files:**
- Create: `tests/fixtures/canary-plan.md`

- [ ] **Step 1: Write the canary plan fixture** — three tasks with explicit Files lists: Task A creates `a.txt`; Task B creates `b.txt` (independent of A); Task C modifies `a.txt` (depends on A). Expected waves: `[[A, B], [C]]`.

- [ ] **Step 2: Run the dependency analysis against the fixture**

Following `references/dependency-analysis.md` (manually or via the skill in a `--plugin-dir` session), compute waves for `tests/fixtures/canary-plan.md`.
Expected: `[[A, B], [C]]`; edge `A → C`; no cycle.

- [ ] **Step 3: Dry-run the workflow authoring** (do not execute a real build): have the skill author the workflow script for the canary and surface it for inspection. Confirm: the script has 2 phases (Wave 1, Wave 2); Wave 1 runs A and B in `parallel()`; each task agent uses `isolation: 'worktree'`; prompts contain the baked discipline; `args` carries `waves` + `integrationBranch`.
Expected: all checks hold.

- [ ] **Step 4: Run the full test + validation suite**

Run: `cd ~/Websites/ultrapowers && python3 -m pytest -q && python3 skills/ultra-driven-development/scripts/validate_skill.py skills/ultra-driven-development`
Expected: tests pass; `skill ok`.

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/canary-plan.md
git commit -m "test: canary plan fixture + dry-run wave/authoring validation"
```

---

### Task 11: Finish

- [ ] **Step 1: Verify the whole suite once more**

Run: `cd ~/Websites/ultrapowers && python3 -m pytest -q && python3 skills/ultra-driven-development/scripts/validate_skill.py skills/ultra-driven-development`
Expected: all green.

- [ ] **Step 2: Complete the branch**

**REQUIRED SUB-SKILL:** Use `superpowers:finishing-a-development-branch` to decide merge / PR / cleanup.
