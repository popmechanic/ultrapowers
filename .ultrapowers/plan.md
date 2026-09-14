# chore(release): 0.3.28 — the clock pass: the suite is the survivors, the worker proves its own task, a ten-task plan in fifteen minutes

**Grammar:** claims-v1

**Claim:** After this run 0.3.28 is released: a fleet worker proves its own task, the suite is the tests that have ever caught something, and a ten-task plan comes in at fifteen minutes where it took twenty-five. (elicited)
**Summary:** This is the release of the 2026-09-14 clock pass, run through the engine it releases. The test estate was cut to the files that have ever caught a defect, the pre-claims plan grammar and two unused skills are gone, the implementer runs only its own task's proofs, each task gets one reviewer and one fix round, the critic is gone, and the box is sized to the plan. Read on the same ten-task plan at the same base, launch to an approved green went from 24.7 minutes to 15.3, with the implementers' worker-minutes seven times fewer and every verdict clean.

**Goal:** The 0.3.28 confidence run and release in one plan: bump `plugin.json` and `marketplace.json` to `0.3.28` and the version in `CLAUDE.md`'s Versioning bullet, and land it through the merged engine at `690d2231`. What this release carries, for the notes: PR #971 (run-126) — 194 zero-catch test files deleted per the catch counter, the legacy plan grammar and its 109 fixture files gone, `--overlap` gone, ultralearn and ultradocket deleted with the counter moved to `skills/ultrapowers/scripts/`, CLAUDE.md rewritten; PR #974 (run-127) — one reviewer per task, one fix round, no critic, the VM sized from the plan's widest wave and the engine's width the plan's, the overlap knob out of the boot chain; PR #976 (run-128) — the implementer's `PROOFS:` block replaces its run-wide test command and the parallelism cap, a bumped launch recompiles under its number; PRs #972, #973, #975 — CLAUDE.md's operator section, the comment-carrier gotcha, the RUNBOOK traps. Readings on #872: run-124 24.7 min → run-129 15.3 min; implementer minutes 146.8 → 21.6; critic 3.0 → 0; 10 clean verdicts both; the replay's base predates the cut so its suite passes are still five minutes, and a current-base plan of the same shape lands near ten. Stabilization of the 0.3 feature set; not a minor bump (operator, 2026-09-14).
**Closes:** #872

**Tech Stack:** JSON manifests, Markdown; pytest is the committed suite.

**Spec:** #872 (the experiment and its readings), #810's 2026-09-14 comments, `CLAUDE.md` §Versioning; every fact a worker needs is in the task's Context.

**Parallelization rationale:** one task. No wave shape; no chain.

**Launch base:** `main` at `690d2231` (#976's merge), so the release commit sits on top of everything it names.

## Global Constraints

- The two manifests carry the same version string.
- Check: python3 -c "import json; a=json.load(open('.claude-plugin/plugin.json'))['version']; b=[p for p in json.load(open('.claude-plugin/marketplace.json'))['plugins'] if p['name']=='ultrapowers'][0]['version']; assert a==b, (a,b); print(a)"
- Nothing but the three files the task names changes.
- Check: test "$(git diff --name-only $ULTRA_BASE | grep -v -e '^.claude-plugin/plugin.json$' -e '^.claude-plugin/marketplace.json$' -e '^CLAUDE.md$' -e '^tests/exams/' | wc -l | tr -d ' ')" = 0

### Task 1: The plugin is 0.3.28 in both manifests and in its own instructions

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`
- Modify: `CLAUDE.md`
- Test: `tests/test_release_0_3_28.py`

**Claim:** The plugin's version reads 0.3.28 in both places it is written and in the project's own instructions, which still say a release is a plan the fleet runs, merged by the sandbox, then tagged by the operator. (derived)
Machine: M1. `.claude-plugin/plugin.json`'s `version` is the string `0.3.28`, and `.claude-plugin/marketplace.json`'s `plugins[name=ultrapowers].version` is the string `0.3.28`; no other key in either file changes. M2. `CLAUDE.md`'s Versioning bullet in `## Conventions & gotchas` contains `0.3.28` followed by the word `today`, the phrase `a release is a fleet plan`, the phrase `merged by the`, and `gh release create`, and contains `0.3.27` followed by `today` nowhere.

**Authorized-by:** `CLAUDE.md` §Versioning and §Working with the operator ("Releases are 0.3.x patches … 0.3.28 stabilizes the 0.3 feature set"); #872's reading of 2026-09-14.

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** Both manifests carry `"version": "0.3.27"` — `plugin.json` at its top-level `version` (line 3) and `marketplace.json` inside `plugins[0]` (the `ultrapowers` entry, line 13). Change only those two strings. `CLAUDE.md`'s Versioning bullet (the one beginning `**Versioning:** 0.x.y`, in `## Conventions & gotchas`) says the two manifests are bumped together and reads `.claude-plugin/plugin.json` carries `0.3.27` today — the only edit is `0.3.27` → `0.3.28` in that clause; leave every other sentence of the bullet as it is, and do not touch the `## Working with the operator` bullet that already names 0.3.28. `tests/test_version_sync.py` no longer exists (deleted by the test cut at zero catches); the Global Constraint `Check:` above is what pins the two manifests equal now. The exam is a pytest file; it is unguarded (a one-run fact), so the examiner writes it under `tests/exams/<run>/` and it lives on the evidence tag.

**Proof:**
- Test: `tests/test_release_0_3_28.py`
- Legs (the driver runs the `Test:` file as this task's exam command): (a) `json.load` of each manifest yields the version string `0.3.28` at its place, and the first `Run:` below reads both files at `$ULTRA_BASE` and asserts the only differing key is that version [M1]; (b) the Versioning bullet, read as the text between `**Versioning:**` and the next `- **`, contains `0.3.28` then `today`, the three phrases, and no `0.3.27` before a `today` [M2].
- Run: python3 -c "import json,subprocess,copy; base=lambda p: json.loads(subprocess.check_output(['git','show','$ULTRA_BASE:'+p])); new=lambda p: json.load(open(p)); a,b=base('.claude-plugin/plugin.json'),new('.claude-plugin/plugin.json'); assert b['version']=='0.3.28', b['version']; a2=dict(a); a2['version']='0.3.28'; assert a2==b, 'plugin.json changed more than version'; m0,m1=base('.claude-plugin/marketplace.json'),new('.claude-plugin/marketplace.json'); e1=[p for p in m1['plugins'] if p['name']=='ultrapowers'][0]; assert e1['version']=='0.3.28', e1['version']; m2=copy.deepcopy(m0); [p.__setitem__('version','0.3.28') for p in m2['plugins'] if p['name']=='ultrapowers']; assert m2==m1, 'marketplace.json changed more than the ultrapowers version'; print('both manifests 0.3.28, nothing else changed')"
- Run: sed -n '/\*\*Versioning:\*\*/,/^- \*\*/p' CLAUDE.md | tr '\n' ' ' | grep -q '0\.3\.28.*today.*a release is a fleet plan.*merged by the.*gh release create'
- Run: test "$(sed -n '/\*\*Versioning:\*\*/,/^- \*\*/p' CLAUDE.md | tr '\n' ' ' | grep -c '0\.3\.27[^0-9]*today')" = 0
- Run: wc -w skills/*/SKILL.md fleet/roles/*.md

**Stale-if:**
- path-absent: `.claude-plugin/marketplace.json`
- path-absent: `fleet/launch.mjs`
