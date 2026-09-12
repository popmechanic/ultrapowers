# chore(release): 0.3.26 — the hub is live and the fleet is watched: eager hub events, the Viz page, the exam re-run, the edge-403 lane, the janitor on the hub

**Grammar:** claims-v1

**Claim:** do: launch the release plan on the merged engine. see: a PR that bumps the plugin to 0.3.26 in both manifests, opened and merged by the sandbox itself, its every event on the hub as it happens; then I tag v0.3.26. (elicited)

**Summary:** This is the release of everything the 2026-09-12 sitting landed, and it is also the proof that the landed engine works, because the release itself runs through it. The run changes two version numbers and one line of the project's own instructions, opens a pull request, and merges it with no hand on the button, while the hub shows each step as it happens. If it lands, the engine that now narrates itself live, re-runs a flaky exam before parking, survives an edge hiccup and lets the janitor read the hub can ship itself; if it does not, the release waits and the record says why.

**Goal:** The 0.3.26 confidence run and release in one plan: bump `plugin.json` and `marketplace.json` to `0.3.26` and the version in `CLAUDE.md`'s Versioning bullet, and land it through the merged engine at `52b63551` — #939 (report format), #940 (the run's kata issue closes at publish), #941 (#892 residuals), #942 (the janitor reads the hub), #943 (the hub carries the run live), #946 (#944 the exam re-run before a park), #947 (#864 the ack by hand), #948 (#859 render plumbing), #949 (#903 the edge-403 attachment lane), #950 (the SIGPIPE guard run-113's baseline caught), and the Viz page live at ultraviz.exe.xyz — so that the release commit on `main` is the sandbox's own squash. The squash commit's title is this plan's H1. The reading this run carries: on its hub project, every `driver:*`, `worker:start`/`worker:end` and `engine:phase` line appears as a comment within a minute of its engine `ts` (the post-#943 lag, the number #810 is still owed). After the merge the operator runs `gh release create v0.3.26` with the sitting's notes.

**Tech Stack:** JSON manifests, Markdown; pytest is the committed suite.

**Spec:** memory `sitting-2026-09-12-kata-followups-and-viz` (what landed and in what order); `CLAUDE.md` §Versioning; every fact a worker needs is in the task's Context.

**Parallelization rationale:** one task. No wave shape; no chain.

**Launch base:** `main` at `52b63551` (#950's merge — run-113 found #940's unguarded reader red at BASE), so the release commit sits on top of everything it names.

## Global Constraints

- The two manifests carry the same version string.
- Check: python3 -c "import json; a=json.load(open('.claude-plugin/plugin.json'))['version']; b=[p for p in json.load(open('.claude-plugin/marketplace.json'))['plugins'] if p['name']=='ultrapowers'][0]['version']; assert a==b, (a,b)"

### Task 1: The plugin is 0.3.26 in both manifests and in its own instructions

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`
- Modify: `CLAUDE.md`
- Test: `tests/test_release_0_3_26.py`

**Claim:** The plugin's version reads 0.3.26 in both places it is written and in the project's own instructions, which still say a release is a plan the fleet runs, merged by the sandbox, then tagged by me. (derived)
Machine: M1. `.claude-plugin/plugin.json`'s `version` is the string `0.3.26`, and `.claude-plugin/marketplace.json`'s `plugins[name=ultrapowers].version` is the string `0.3.26`; no other key in either file changes. M2. `CLAUDE.md`'s Versioning bullet in `## Conventions & gotchas` contains, in order, `0.3.26 today`, the phrase `a release is a fleet plan`, the phrase `merged by the sandbox`, and `gh release create v0.x.y`, contains `0.3.25 today` nowhere, and contains neither `--auto --squash` nor `gh run list`. M3. `python3 -m pytest -q tests/test_version_sync.py` passes on the tree.

**Authorized-by:** `CLAUDE.md` §Versioning; #871 decision 3 (no CI); the operator's release practice (memory `versioning-0-2-x-stays`: bundle merges, release once after a confidence check)

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** Both manifests carry `"version": "0.3.25"` — `plugin.json` at its top-level `version` (line 3) and `marketplace.json` inside `plugins[0]` (the `ultrapowers` entry, line 13). Change only those two strings; `tests/test_version_sync.py` pins that they match and stays as it is. `CLAUDE.md`'s Versioning bullet (the one beginning `**Versioning:** 0.x.y`, in `## Conventions & gotchas`) already says a release is a fleet plan, that the PR is opened and merged by the sandbox, that the operator then runs `gh release create v0.x.y`, and that 0.3.25 (2026-09-10) was the first release shipped this way; the only edit is its parenthetical `— 0.3.25 today —` → `— 0.3.26 today —`. Leave every other sentence of the bullet, including the 0.3.25 example, as it is. The exam is a pytest file; it is unguarded (a one-run fact), so the examiner writes it under `tests/exams/<run>/` and it stays on the evidence tag. The prose-size report that used to ride the release commit body is a `Run:` here so the record carries it.

**Proof:**
- Test: `tests/test_release_0_3_26.py`
- Legs (the driver runs the `Test:` file as this task's exam command): (a) `json.load` of each manifest yields the version string `0.3.26` at its place [M1], and the first Run: below reads both files at BASE with `git show $ULTRA_BASE:<path>`, sets the BASE copy's version (plugin.json's top-level `version`; marketplace.json's `ultrapowers` entry's `version`) to `0.3.26`, and requires the whole BASE document, so adjusted, to deep-equal the new one — any other key, top-level or nested, in either file, that changed fails it [M1]; (b) the Versioning bullet, cut from its `- **Versioning:**` line to the next `- **` bullet and joined, matches `0\.3\.26 today.*a release is a fleet plan.*merged by the sandbox.*gh release create v0\.x\.y`, does not contain `0.3.25 today`, and contains neither `--auto --squash` nor `gh run list`; a bullet left at `0.3.25 today` fails [M2]; (c) `tests/test_version_sync.py` passes [M3].
- Run: python3 -c "import json,subprocess,copy; base=lambda p: json.loads(subprocess.check_output(['git','show','$ULTRA_BASE:'+p])); new=lambda p: json.load(open(p)); a,b=base('.claude-plugin/plugin.json'),new('.claude-plugin/plugin.json'); assert b['version']=='0.3.26', b['version']; a2=dict(a); a2['version']='0.3.26'; assert a2==b, 'plugin.json changed more than version'; m0,m1=base('.claude-plugin/marketplace.json'),new('.claude-plugin/marketplace.json'); e1=[p for p in m1['plugins'] if p['name']=='ultrapowers'][0]; assert e1['version']=='0.3.26', e1['version']; m2=copy.deepcopy(m0); [p.__setitem__('version','0.3.26') for p in m2['plugins'] if p['name']=='ultrapowers']; assert m2==m1, 'marketplace.json changed more than the ultrapowers version'; print('both manifests 0.3.26, nothing else changed')"
- Run: python3 -m pytest -q tests/test_version_sync.py
- Run: wc -w skills/*/SKILL.md fleet/roles/*.md

**Stale-if:**
- path-absent: `tests/test_version_sync.py`
- path-absent: `.claude-plugin/marketplace.json`
