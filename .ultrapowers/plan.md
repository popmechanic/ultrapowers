# chore(release): 0.3.25 — the ceremony cut: the suite reports, the PR is the gate, the card reads for a person, and the fleet turns where the operator can see it

**Grammar:** claims-v1

**Claim:** do: launch the release plan on the merged engine. see: a PR that bumps the plugin to 0.3.25 in both manifests, opened and merged by the sandbox itself with no CI and no hand merge; then I tag v0.3.25 and the fleet that shipped the queue is the fleet that shipped its own release. (elicited)

**Summary:** This is the release of everything the 2026-09-10 sitting landed, and it is also the proof that the landed engine works, because the release itself runs through it. The run changes two version numbers and one paragraph of the project's own instructions, opens a pull request, and merges it with no continuous-integration service and no hand on the button. If it lands, the engine that deleted the ceremony, re-gated the merge, rewrote the card and lit the fleet's page can ship itself; if it does not, the release waits and the record says why.

**Goal:** The 0.3.25 confidence run and release in one plan: bump `plugin.json` and `marketplace.json` to `0.3.25`, teach `CLAUDE.md` that a release is a fleet plan, and land it through the merged engine — the run-88 ceremony cut, the engine plan (the suite reports; the PR is the gate), the card, the Viz sensor and #887 — so that the release commit on `main` is the sandbox's own squash. The squash commit's title is this plan's H1. The reading #862 asked for rides this run: on its tag, the first `worker:start` precedes the baseline's `worker:end`. After the merge the operator runs `gh release create v0.3.25` with the sitting's notes.

**Closes:** #886 #892 #887

**Tech Stack:** JSON manifests, Markdown; pytest is the committed suite.

**Spec:** memory `sitting-2026-09-10-ceremony-cut` (the queue and its order); `CLAUDE.md` §Versioning; every fact a worker needs is in the task's Context.

**Parallelization rationale:** one task. No wave shape; no chain.

**Launch base:** the merge of the last queued plan (the Viz sensor or #887, whichever lands last), so the release commit sits on top of everything it names. The `**Closes:**` line is extended at launch with every ticket the queue resolved but did not close (candidates: #877 once the sensor lands, #887 once its plan lands, #864 answered by #878 decision 7).

## Global Constraints

- The two manifests carry the same version string.
- Check: python3 -c "import json; a=json.load(open('.claude-plugin/plugin.json'))['version']; b=[p for p in json.load(open('.claude-plugin/marketplace.json'))['plugins'] if p['name']=='ultrapowers'][0]['version']; assert a==b, (a,b)"

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The plugin is 0.3.25, and the instructions say a release is a fleet plan

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`
- Modify: `CLAUDE.md`
- Test: `tests/test_release_0_3_25.py`

**Claim:** The plugin's version reads 0.3.25 in both places it is written, and the project's instructions say a release is a plan the fleet runs, merged by the sandbox, then tagged by me. (derived)
Machine: M1. `.claude-plugin/plugin.json`'s `version` is the string `0.3.25`, and `.claude-plugin/marketplace.json`'s `plugins[name=ultrapowers].version` is the string `0.3.25`; no other key in either file changes. M2. `CLAUDE.md`'s Versioning bullet in `## Conventions & gotchas` contains, in order, `0.3.25`, the phrase `a release is a fleet plan`, the phrase `merged by the sandbox`, and `gh release create v0.x.y`, and contains neither `--auto --squash` nor `gh run list`. M3. `python3 -m pytest -q tests/test_version_sync.py` passes on the tree.

**Authorized-by:** `CLAUDE.md` §Versioning; #871 decision 3 (no CI); the operator's release practice (memory `versioning-0-2-x-stays`: bundle merges, release once after a confidence check)

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** Both manifests carry `"version": "0.3.24"` — `plugin.json` at its top-level `version` (line 3) and `marketplace.json` inside `plugins[0]` (the `ultrapowers` entry, line 13). Change only those two strings; `tests/test_version_sync.py` pins that they match and stays as it is. `CLAUDE.md`'s Versioning bullet (the one beginning `**Versioning:** 0.x.y`) says today that a release commit is `chore(release): 0.0.x — …` landed through a PR with `gh pr merge --auto --squash` so the required check runs in front of it, then `gh release create v0.x.y`, and that CI on main must be confirmed green afterwards; the engine plan's documents task has already removed `--auto --squash` and `gh run list` from it — if they are still present at this run's base, remove them here too (same-file text folds). Rewrite the bullet's procedure sentences to: a release is a fleet plan — its H1 is the `chore(release): 0.x.y — …` line, its one task bumps both manifests to the new version and edits this bullet's version, the sandbox opens and merges the PR (the squash commit's title is the H1), and the operator then runs `gh release create v0.x.y` with the notes; 0.3.25 (2026-09-10) was the first release shipped this way. Keep the bullet's first sentences (0.x.y, minor vs patch, the 0.3.5 example, both manifests, `plugin.json` wins on drift) and mention `0.3.25` as the example version. The exam is a pytest file; it is unguarded (a one-run fact), so the examiner writes it under `tests/exams/<run>/` and it stays on the evidence tag. The prose-size report that used to ride the release commit body is a `Run:` here so the record carries it.

**Proof:**
- Test: `tests/test_release_0_3_25.py`
- Legs (the driver runs the `Test:` file as this task's exam command): (a) `json.load` of each manifest yields the version string `0.3.25` at its place [M1], and the first Run: below reads both files at BASE with `git show $ULTRA_BASE:<path>`, sets the BASE copy's version (plugin.json's top-level `version`; marketplace.json's `ultrapowers` entry's `version`) to `0.3.25`, and requires the whole BASE document, so adjusted, to deep-equal the new one — any other key, top-level or nested, in either file, that changed fails it [M1]; (b) the Versioning bullet, cut from `## Conventions` to the next `- **` bullet and joined, matches `0.3.25.*a release is a fleet plan.*merged by the sandbox.*gh release create v0\.x\.y` and contains neither `--auto --squash` nor `gh run list` [M2]; (c) `tests/test_version_sync.py` passes [M3].
- Run: python3 -c "import json,subprocess,copy; base=lambda p: json.loads(subprocess.check_output(['git','show','$ULTRA_BASE:'+p])); new=lambda p: json.load(open(p)); a,b=base('.claude-plugin/plugin.json'),new('.claude-plugin/plugin.json'); assert b['version']=='0.3.25', b['version']; a2=dict(a); a2['version']='0.3.25'; assert a2==b, 'plugin.json changed more than version'; m0,m1=base('.claude-plugin/marketplace.json'),new('.claude-plugin/marketplace.json'); e1=[p for p in m1['plugins'] if p['name']=='ultrapowers'][0]; assert e1['version']=='0.3.25', e1['version']; m2=copy.deepcopy(m0); [p.__setitem__('version','0.3.25') for p in m2['plugins'] if p['name']=='ultrapowers']; assert m2==m1, 'marketplace.json changed more than the ultrapowers version'; print('both manifests 0.3.25, nothing else changed')"
- Run: python3 -m pytest -q tests/test_version_sync.py
- Run: wc -w skills/*/SKILL.md fleet/roles/*.md

**Stale-if:**
- path-absent: `tests/test_version_sync.py`
- path-absent: `.claude-plugin/marketplace.json`
