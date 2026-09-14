# chore(release): 0.3.27 — the worker is an actor and the fold is order-free: kata Phase A, KATA_REF reaches the worker, the sequential-adoption sim green on real joins, a parked run stays open for a person

**Grammar:** claims-v1

**Claim:** do: launch the release plan on the merged engine. see: a PR that bumps the plugin to 0.3.27 in both manifests, opened and merged by the sandbox itself, and on its task's hub issue the first note a worker has ever written there; then I tag v0.3.27. (elicited)

**Summary:** This is the release of everything the 2026-09-13 sitting landed, and the proof that the landed engine works, because the release itself runs through it. The run changes two version numbers and one line of the project's own instructions, opens a pull request, and merges it with no hand on the button, while its worker, for the first time, carries the reference to its own hub issue. If it lands, the engine that now lets workers speak on the tracker, leaves a parked run open as a question for a person, and has shown that folding tasks one at a time gives the same tree as folding the wave can ship itself; if it does not, the release waits and the record says why.

**Goal:** The 0.3.27 confidence run and release in one plan: bump `plugin.json` and `marketplace.json` to `0.3.27` and the version in `CLAUDE.md`'s Versioning bullet, and land it through the merged engine at `47c936d0` — #958/#959/#960 (#810 Phase A: the worker is a kata actor; the flat `work.attention` read), #952 (the phase cell reads the run's own progress), #962 and #966 (#832: the sequential-adoption fold sim, green on the corpus and on the real joins `contend`, `contend-wide`, `degrade` — the Phase C gate), #965 (#963: `KATA_REF` reaches the worker), #967 (#964: a parked run's issue stays open as the needs-human row; the janitor reads the state key), #957 (docs) — so that the release commit on `main` is the sandbox's own squash. The squash commit's title is this plan's H1. The reading this run carries: the first launch since #963, so its task issue on the hub shows whether the implementer writes a comment under its own author (`impl:1@run-<N>`) — the half of Phase A runs 116 and 118 could not observe. After the merge the operator runs `gh release create v0.3.27` with the sitting's notes.

**Tech Stack:** JSON manifests, Markdown; pytest is the committed suite.

**Spec:** memory `sitting-2026-09-13-pm-runs-116-120` (what landed and in what order); `CLAUDE.md` §Versioning; every fact a worker needs is in the task's Context.

**Parallelization rationale:** one task. No wave shape; no chain.

**Launch base:** `main` at `47c936d0` (#964's merge), so the release commit sits on top of everything it names.

## Global Constraints

- The two manifests carry the same version string.
- Check: python3 -c "import json; a=json.load(open('.claude-plugin/plugin.json'))['version']; b=[p for p in json.load(open('.claude-plugin/marketplace.json'))['plugins'] if p['name']=='ultrapowers'][0]['version']; assert a==b, (a,b)"

### Task 1: The plugin is 0.3.27 in both manifests and in its own instructions

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`
- Modify: `CLAUDE.md`
- Test: `tests/test_release_0_3_27.py`

**Claim:** The plugin's version reads 0.3.27 in both places it is written and in the project's own instructions, which still say a release is a plan the fleet runs, merged by the sandbox, then tagged by me. (derived)
Machine: M1. `.claude-plugin/plugin.json`'s `version` is the string `0.3.27`, and `.claude-plugin/marketplace.json`'s `plugins[name=ultrapowers].version` is the string `0.3.27`; no other key in either file changes. M2. `CLAUDE.md`'s Versioning bullet in `## Conventions & gotchas` contains, in order, `0.3.27 today`, the phrase `a release is a fleet plan`, the phrase `merged by the sandbox`, and `gh release create v0.x.y`, contains `0.3.26 today` nowhere, and contains neither `--auto --squash` nor `gh run list`. M3. `python3 -m pytest -q tests/test_version_sync.py` passes on the tree.

**Authorized-by:** `CLAUDE.md` §Versioning; #871 decision 3 (no CI); the operator's release practice (memory `versioning-0-2-x-stays`: bundle merges, release once after a confidence check)

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** Both manifests carry `"version": "0.3.26"` — `plugin.json` at its top-level `version` (line 3) and `marketplace.json` inside `plugins[0]` (the `ultrapowers` entry, line 13). Change only those two strings; `tests/test_version_sync.py` pins that they match and stays as it is. `CLAUDE.md`'s Versioning bullet (the one beginning `**Versioning:** 0.x.y`, in `## Conventions & gotchas`) already says a release is a fleet plan, that the PR is opened and merged by the sandbox, that the operator then runs `gh release create v0.x.y`, and that 0.3.25 (2026-09-10) was the first release shipped this way; the only edit is its parenthetical `— 0.3.26 today —` → `— 0.3.27 today —`. Leave every other sentence of the bullet, including the 0.3.25 example, as it is. The exam is a pytest file; it is unguarded (a one-run fact), so the examiner writes it under `tests/exams/<run>/` and it stays on the evidence tag. The prose-size report that used to ride the release commit body is a `Run:` here so the record carries it.

**Proof:**
- Test: `tests/test_release_0_3_27.py`
- Legs (the driver runs the `Test:` file as this task's exam command): (a) `json.load` of each manifest yields the version string `0.3.27` at its place [M1], and the first Run: below reads both files at BASE with `git show $ULTRA_BASE:<path>`, sets the BASE copy's version (plugin.json's top-level `version`; marketplace.json's `ultrapowers` entry's `version`) to `0.3.27`, and requires the whole BASE document, so adjusted, to deep-equal the new one — any other key, top-level or nested, in either file, that changed fails it [M1]; (b) the Versioning bullet, cut from its `- **Versioning:**` line to the next `- **` bullet and joined, matches `0\.3\.27 today.*a release is a fleet plan.*merged by the sandbox.*gh release create v0\.x\.y`, does not contain `0.3.26 today`, and contains neither `--auto --squash` nor `gh run list`; a bullet left at `0.3.26 today` fails [M2]; (c) `tests/test_version_sync.py` passes [M3].
- Run: python3 -c "import json,subprocess,copy; base=lambda p: json.loads(subprocess.check_output(['git','show','$ULTRA_BASE:'+p])); new=lambda p: json.load(open(p)); a,b=base('.claude-plugin/plugin.json'),new('.claude-plugin/plugin.json'); assert b['version']=='0.3.27', b['version']; a2=dict(a); a2['version']='0.3.27'; assert a2==b, 'plugin.json changed more than version'; m0,m1=base('.claude-plugin/marketplace.json'),new('.claude-plugin/marketplace.json'); e1=[p for p in m1['plugins'] if p['name']=='ultrapowers'][0]; assert e1['version']=='0.3.27', e1['version']; m2=copy.deepcopy(m0); [p.__setitem__('version','0.3.27') for p in m2['plugins'] if p['name']=='ultrapowers']; assert m2==m1, 'marketplace.json changed more than the ultrapowers version'; print('both manifests 0.3.27, nothing else changed')"
- Run: python3 -m pytest -q tests/test_version_sync.py
- Run: wc -w skills/*/SKILL.md fleet/roles/*.md

**Stale-if:**
- path-absent: `tests/test_version_sync.py`
- path-absent: `.claude-plugin/marketplace.json`
