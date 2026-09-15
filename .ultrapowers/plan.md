# chore(release): 0.3.29 — the record is the scheduler: the ready set, the fold that buys something, one hub project per target

**Grammar:** claims-v1

**Claim:** After this run 0.3.29 is released: a task starts the moment what it depends on has folded in, a fold is paid only when it releases work, and a plan I relaunch files on the hub beside its earlier run instead of being refused. (elicited)
**Summary:** This is the release of the 2026-09-14 and 2026-09-15 sittings, run through the engine it releases. The wave loop is gone: a task is dispatched as soon as its predecessors are adopted, a stuck worker re-edges instead of failing, a fold happens only when it makes a task ready, ends the run, or a result has waited a suite's length, and the kata hub holds one project per target with every run's issue filed beside the last. Alongside it the compiler evaluates a plan's Stale-if lines at the launch base, the interaction exam reaches ultrawrite, the report reference describes the engine as it is, and a relaunch reuses the tasks a parked run already finished.

**Goal:** The 0.3.29 confidence run and release in one plan: bump `plugin.json` and `marketplace.json` to `0.3.29` and the version in `CLAUDE.md`'s Versioning bullet, and land it through the merged engine at `fdb2dd27`. What this release carries, for the notes: PR #981 (run-131) — one kata project per target, seeded idempotently, and a proof that runs a sibling's file is an edge; PR #982 (run-132) — a relaunch reuses the tasks a parked run already finished, stamped on the hub at close and folded in from the evidence tag at setup; PR #985 (run-133) — the record is the scheduler: a task starts when what it depends on is folded in, a stuck worker re-edges instead of failing; PR #1001 (run-135) — the plugin side of the click: ultrawrite teaches the interaction exam, the renderer plumbing leaves launcher, setup, boot and doctor (eight rows), the report row carries `action_ms` and `browser`; PR #1002 (run-138) and #1004 (run-139) — the report reference describes the ready-set engine and a re-edged task reads `waiting` on the page; PR #1003 (run-137) — the compiler evaluates the five Stale-if predicates at `--check --base` and refuses a task whose predicate holds; PR #1005 (run-136) and #1007 (run-140) — a fold only when it releases work, ends the run, or adopts a result aged a suite's length, `why` on every adoption event, and the hub shows `landed` then `adopted`; PR #1009 (hand, #1008) — the run issue is created with `force_new`; PR #984 (hand) — CLAUDE.md's sim list is the tree. Readings on the record: run-134's replay of run-67's plan on the Phase C engine took 38.1 min against run-129's 15.3, five folds of a five-minute suite where the wave engine paid one (#979), which is the reading the fold rule answers; run-141, launched on this base's engine at `1c97ba44` with `--hold`, is the fold rule's pre-registered measurement and is not in this release. Stabilization of the 0.3 feature set; a patch, not a minor bump (operator, 2026-09-14).

**Tech Stack:** JSON manifests, Markdown; pytest is the committed suite.

**Spec:** #810's 2026-09-14 and 2026-09-15 comments, #979's reading, `CLAUDE.md` §Versioning; every fact a worker needs is in the task's Context.

**Parallelization rationale:** one task. No wave shape; no chain.

**Launch base:** `main` at `fdb2dd27` (#1009's merge), so the release commit sits on top of everything it names.

## Global Constraints

- The two manifests carry the same version string; the task's own `Run:` lines pin it, since every path the check would name is the task's.
- Nothing but the three files the task names changes; the task's `Run:` over `git diff --name-only $ULTRA_BASE` pins it.

### Task 1: The plugin is 0.3.29 in both manifests and in its own instructions

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`
- Modify: `CLAUDE.md`
- Test: `tests/test_release_0_3_29.py`

**Claim:** The plugin's version reads 0.3.29 in both places it is written and in the project's own instructions, which still say a release is a plan the fleet runs, merged by the sandbox, then tagged by the operator. (derived)
Machine: M1. `.claude-plugin/plugin.json`'s `version` is the string `0.3.29`, and `.claude-plugin/marketplace.json`'s `plugins[name=ultrapowers].version` is the string `0.3.29`; no other key in either file changes. M2. `CLAUDE.md`'s Versioning bullet in `## Conventions & gotchas` contains `0.3.29` followed by the word `today`, the phrase `a release is a fleet plan`, the phrase `merged by the`, and `gh release create`, and contains `0.3.28` followed by `today` nowhere. M3. The two manifests carry one and the same version string, and `git diff --name-only $ULTRA_BASE` names nothing outside the three files this task modifies, `tests/exams/`, and this task's own exam file `tests/test_release_0_3_29.py`.

**Authorized-by:** `CLAUDE.md` §Versioning and §Working with the operator ("Releases are 0.3.x patches that bundle several merges behind a confidence run"); the operator's 2026-09-15 confirmation of this plan's Claim.

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** Both manifests carry `"version": "0.3.28"` — `plugin.json` at its top-level `version` (line 3) and `marketplace.json` inside `plugins[0]` (the `ultrapowers` entry, line 13). Change only those two strings. `CLAUDE.md`'s Versioning bullet (the one beginning `**Versioning:** 0.x.y`, in `## Conventions & gotchas`) says the two manifests are bumped together and reads `.claude-plugin/plugin.json` carries `0.3.28` today — the only edit is `0.3.28` → `0.3.29` in that clause; leave every other sentence of the bullet as it is, and do not touch the `## Working with the operator` bullet that says 0.3.28 stabilizes the 0.3 feature set — that sentence is history and stays. The doctor sentence in the Layout section already says eight rows (run-135 edited it); nothing there changes. `tests/test_version_sync.py` does not exist (deleted at zero catches); the Global Constraint `Check:` above is what pins the two manifests equal. The exam is a pytest file; it is unguarded (a one-run fact), so the examiner writes it under `tests/exams/<run>/` and it lives on the evidence tag.

**Proof:**
- Test: `tests/test_release_0_3_29.py`
- Legs (the driver runs the `Test:` file as this task's exam command): (a) `json.load` of each manifest yields the version string `0.3.29` at its place, and the first `Run:` below reads both files at `$ULTRA_BASE` and asserts the only differing key is that version [M1]; (b) the Versioning bullet, read as the text between `**Versioning:**` and the next `- **`, contains `0.3.29` then `today`, the three phrases, and no `0.3.28` before a `today` [M2]; (c) the fourth and fifth `Run:` lines below — the two manifests' versions equal, and the diff against `$ULTRA_BASE` naming no path outside the three files, `tests/exams/` and `tests/test_release_0_3_29.py` — exit 0 [M3].
- Run: python3 -c "import json,subprocess,copy; base=lambda p: json.loads(subprocess.check_output(['git','show','$ULTRA_BASE:'+p])); new=lambda p: json.load(open(p)); a,b=base('.claude-plugin/plugin.json'),new('.claude-plugin/plugin.json'); assert b['version']=='0.3.29', b['version']; a2=dict(a); a2['version']='0.3.29'; assert a2==b, 'plugin.json changed more than version'; m0,m1=base('.claude-plugin/marketplace.json'),new('.claude-plugin/marketplace.json'); e1=[p for p in m1['plugins'] if p['name']=='ultrapowers'][0]; assert e1['version']=='0.3.29', e1['version']; m2=copy.deepcopy(m0); [p.__setitem__('version','0.3.29') for p in m2['plugins'] if p['name']=='ultrapowers']; assert m2==m1, 'marketplace.json changed more than the ultrapowers version'; print('both manifests 0.3.29, nothing else changed')"
- Run: sed -n '/\*\*Versioning:\*\*/,/^- \*\*/p' CLAUDE.md | tr '\n' ' ' | grep -q '0\.3\.29.*today.*a release is a fleet plan.*merged by the.*gh release create'
- Run: test "$(sed -n '/\*\*Versioning:\*\*/,/^- \*\*/p' CLAUDE.md | tr '\n' ' ' | grep -c '0\.3\.28[^0-9]*today')" = 0
- Run: python3 -c "import json; a=json.load(open('.claude-plugin/plugin.json'))['version']; b=[p for p in json.load(open('.claude-plugin/marketplace.json'))['plugins'] if p['name']=='ultrapowers'][0]['version']; assert a==b, (a,b); print(a)"
- Run: test "$(git diff --name-only $ULTRA_BASE | grep -v -e '^.claude-plugin/plugin.json$' -e '^.claude-plugin/marketplace.json$' -e '^CLAUDE.md$' -e '^tests/exams/' -e '^tests/test_release_0_3_29.py$' | wc -l | tr -d ' ')" = 0
- Run: wc -w skills/*/SKILL.md fleet/roles/*.md

**Stale-if:**
- path-absent: `.claude-plugin/marketplace.json`
- path-absent: `fleet/launch.mjs`
