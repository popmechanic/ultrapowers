# Evidence home — every run's plan and record in one evidence repository

**Grammar:** claims-v1
**Claim:** Every run's plan and record live in one evidence repository, one folder and one tag per run, the old runs copied in, and the product repository carries only the run's pull request branch. (elicited)
**Summary:** This moves everything a run writes about itself, its plan and its record, out of the product it works on and into one evidence repository, with one folder and one tag per run, and copies the old runs in. It exists because the evidence is our record about the product, not part of it: five hundred and fifty run tags cluttered this repository, a repository we cannot push to could not take a record at all, and reading many runs meant fetching tags one repository at a time. The product repository keeps only the run's pull request, and every run on every product is read in one place.

**Goal:** The evidence-home half of #1395: the operator's one setting (`"evidence": "<owner>/<repo>"` in `~/.ultrapowers/fleet.json`, overridable per launch with `--evidence-repo`) names the evidence repository for every target, foreign ones included; the launcher pushes the plan commit to `live/<target-owner>-<target-repo>/run-<N>` there, the first-boot setup script tells the VM the repository, the sandbox grows the record in `runs/<target-owner>-<target-repo>/<N>/` and cuts one tag `<target-owner>-<target-repo>/run-<N>` at the end of every run, the laptop readers read only that repository, the doctor's new `evidence` row walks the one-time setup, and `node fleet/migrate-evidence.mjs` copies the old runs in.
**Closes:** #1395
**Tech Stack:** Node (ES modules), bash (the boot), Python 3 (the census), git, Markdown
**Spec:** none — #1395 and the operator's picks of 2026-09-29 (plan 2 of 3)

## Global Constraints

- The evidence repository is the operator's setting (`evidence` in `~/.ultrapowers/fleet.json`, or `--evidence-repo`), never derived from the target's owner; no tool guesses it and none reads it off a VM comment.
- No run writes a ref to the product (target) repository except its pull request branch `ultra/integration-run-<N>`.
- No tool writes to the evidence repository's `main` branch: it holds a one-time hand archive under `archive/`, and runs live only under `runs/`, on `live/*` branches and on `<target-owner>-<target-repo>/run-<N>` tags.
- No probe and no sim opens a network socket or reaches real GitHub: local bare repositories and exec stubs only, as the fleet sims already do.
- The rollback is a launch from a checkout made before this plan's merge: no switch flag, no dual write, one code path.
- Check: python3 -m pytest -q

### Task 1: The evidence setting and ref names, in one place

**Type:** implementation

**Files:**
- Modify: `fleet/lobby.mjs`
- Create: `fleet/tests/test_lobby_evidence_refs.mjs`

**Claim:** Every fleet tool takes the evidence repository from the operator's one setting and names a run's folder, live branch and tag the same way. (derived)
Machine: M1. `evidenceRepoFor({ evidence: 'ops/evidence' })` is `'ops/evidence'`, `evidenceRepoFor({ evidence: 'ops/evidence' }, 'x/y')` is `'x/y'`, and `evidenceRepoFor({})` and `evidenceRepoFor({ evidence: 'not a repo' })` are each `null`. M2. `runFolderFor('o/r', 5)` is `'runs/o-r/5'`, `liveBranchFor('o/r', 5)` is `'live/o-r/run-5'`, `runTagFor('o/r', 5)` is `'o-r/run-5'` and `evidenceUrlFor('ops/evidence')` is `'https://github.com/ops/evidence.git'`. M3. `runOfEvidenceRef('o/r', ref)` is `5` for each of `refs/heads/live/o-r/run-5` and `refs/tags/o-r/run-5`, and `null` for each of `refs/tags/o-x/run-5`, `refs/tags/o-r/run-5^{}` and `refs/tags/ultra/evidence/run-5`. M4. `highestRunInEvidence` over a local bare evidence repository holding `refs/tags/o-r/run-4`, `refs/heads/live/o-r/run-6` and `refs/tags/o-x/run-9` answers `6` for target `o/r`; over one holding no `o-r` ref it answers `0`; a non-zero `ls-remote` throws a `Refusal`. M5. `readEvidenceSetting({ path })` answers `'ops/evidence'` for a file `{"evidence": "ops/evidence"}`, and `null` for an absent file and for a file without the key. M6. `planBranchFor`, `evidenceBranchFor`, `planTagFor`, `evidenceTagFor`, `runOfBranch` and `highestRunOnTarget` are still exported functions, and `COMMENT_KEYS` does not include `evidence`.

**Authorized-by:** #1395; the operator's picks of 2026-09-29 and their ruling of the same day (the evidence repository is the operator's setting)

**Interfaces:**
- Consumes: none
- Produces: `evidenceRepoFor(config, override = null) -> string | null`
- Produces: `readEvidenceSetting({ path } = {}) -> Promise<string | null>`
- Produces: `runFolderFor(target, run) -> string`
- Produces: `liveBranchFor(target, run) -> string`
- Produces: `runTagFor(target, run) -> string`
- Produces: `runOfEvidenceRef(target, ref) -> number | null`
- Produces: `evidenceUrlFor(repo) -> string`
- Produces: `highestRunInEvidence(exec, repoDir, evidenceRepo, target) -> Promise<number>`

**Context:** Shared literals (#1395): the evidence repository is the operator's setting, the key `evidence` (value `<owner>/<repo>`) in `~/.ultrapowers/fleet.json` (`DEFAULT_CONFIG_PATH()`), overridden for one launch by `--evidence-repo <owner>/<repo>`; nothing derives it from the target, and there is no default. Its exe.dev integration is `gh-<owner>-<repo>` (`githubIntegrationFor`). A run's folder, live branch and tag are keyed by the TARGET's slug (`targetSlug(target)`, `o/r` → `o-r`, collision-free across owners, so a foreign `facebook/react` run lands in `runs/facebook-react/<N>/`): folder `runs/<slug>/<N>`, live branch `live/<slug>/run-<N>`, tag `<slug>/run-<N>`. `readEvidenceSetting` is the one reader of the key, shaped like `fleetConfigAccount` in `fleet/doctor.mjs` (~192): an unreadable or non-JSON file, a missing key, or a value `isSafeTarget` refuses all answer `null`. `evidenceRepoFor` is pure: the override when it is a safe target, else `config.evidence` when it is one, else `null`. `loadFleetConfig` and `FLEET_DEFAULTS` are unchanged (they size the pool). The new helpers sit beside the old ones at `fleet/lobby.mjs:91-150`; keep every old export (the migration and the launcher's target-side refusal still read old refs; `highestRunOnTarget` ~578 stays), and leave `COMMENT_KEYS` (~537) as it is: the VM learns the repository from its first-boot setup script, not the comment (the comment holds 200 bytes and a run-277 comment on `popmechanic/ultrapowers` is already 189). `runOfEvidenceRef` matches the slug literally and as a whole path segment (escape regex characters; slugs carry `.`, `-`, `_`), with or without the `refs/heads/` / `refs/tags/` head, so `popmechanic-ultrapowers-run-110/run-5` is not a run of `popmechanic/ultrapowers`; a peeled `^{}` line and a non-numeric tail are null. `highestRunInEvidence` is one `git -C <repoDir> ls-remote <evidenceUrlFor(evidenceRepo)> refs/heads/live/<slug>/run-* refs/tags/<slug>/run-*` through the exec seam, the highest `runOfEvidenceRef` over its lines or 0, a non-zero exit a `Refusal` naming the command. The sim builds its bare repository and config files in a temp dir, hands `highestRunInEvidence` an exec that rewrites the `https://github.com/…` URL to the local path, prints `ALL TESTS PASSED`, and opens no socket (`fleet/tests/test_sims_are_hermetic.mjs` reads every `test_*.mjs`).

**Proof:**
- Run: node -e "import('./fleet/lobby.mjs').then((m) => { const c = { evidence: 'ops/evidence' }; if (m.evidenceRepoFor(c) !== 'ops/evidence' || m.evidenceRepoFor(c, 'x/y') !== 'x/y' || m.evidenceRepoFor({}) !== null || m.evidenceRepoFor({ evidence: 'not a repo' }) !== null) process.exit(1) })" [M1]
- Run: node -e "import('./fleet/lobby.mjs').then((m) => { const got = [m.runFolderFor('o/r', 5), m.liveBranchFor('o/r', 5), m.runTagFor('o/r', 5), m.evidenceUrlFor('ops/evidence')].join(' '); if (got !== 'runs/o-r/5 live/o-r/run-5 o-r/run-5 https://github.com/ops/evidence.git') process.exit(1) })" [M2]
- Run: node -e "import('./fleet/lobby.mjs').then((m) => { const f = (r) => m.runOfEvidenceRef('o/r', r); if (f('refs/heads/live/o-r/run-5') !== 5 || f('refs/tags/o-r/run-5') !== 5 || f('refs/tags/o-x/run-5') !== null || f('refs/tags/o-r/run-5^{}') !== null || f('refs/tags/ultra/evidence/run-5') !== null) process.exit(1) })" [M3]
- Run: node fleet/tests/test_lobby_evidence_refs.mjs | grep -q 'ALL TESTS PASSED' [M4, M5]
- Run: node -e "import('./fleet/lobby.mjs').then((m) => { for (const k of ['planBranchFor', 'evidenceBranchFor', 'planTagFor', 'evidenceTagFor', 'runOfBranch', 'highestRunOnTarget']) if (typeof m[k] !== 'function') process.exit(1); if (m.COMMENT_KEYS.includes('evidence')) process.exit(1) })" [M6]
- Legs: (a) the setting, the override, and null for none and for a malformed value [M1]; (b) the folder, live branch, tag and URL strings byte-exact [M2]; (c) the two run refs read 5 and the three foreign refs read null [M3]; (d) the highest run over a real bare repository is 6, an empty one 0, a failed listing refuses [M4]; (e) the key read from a file, null for no file and no key [M5]; (f) the six old helpers are still functions and the comment keys carry no `evidence` [M6].

**Stale-if:**
- path-absent: `fleet/lobby.mjs`
- issue-closed: #1395

### Task 2: The launcher pushes the plan to the operator's evidence repository

**Type:** implementation

**Files:**
- Modify: `fleet/launch.mjs`
- Modify: `fleet/setup-script.mjs`
- Modify: `fleet/tests/_lobby_helpers.mjs`
- Modify: `fleet/tests/test_launch_credential.mjs`
- Modify: `fleet/tests/test_launch_duplicate.mjs`
- Modify: `fleet/tests/test_launch_one_engine.mjs`
- Modify: `fleet/tests/test_launch_plan_path.mjs`
- Modify: `fleet/tests/test_launch_probe_runners.mjs`
- Modify: `fleet/tests/test_launch_stories_grammar.mjs`
- Create: `fleet/tests/test_launch_evidence.mjs`
- Create: `fleet/tests/test_setup_script_evidence.mjs`

**Claim:** A launch puts the run's plan in the operator's evidence repository, tells the VM where that is, and writes nothing to the product repository. (derived)
Machine: M1. A launch on target `o/r` with the setting `ops/evidence`, whose plan has a sibling gate record, pushes exactly one commit, to `refs/heads/live/o-r/run-1` of `ops/evidence`: the commit has no parent, its tree is exactly `runs/o-r/1/plan.md` and `runs/o-r/1/gate-verdicts.json`, its message names `o/r` and the base sha, and the target's refs are the same after the launch as before it. M2. With the evidence repository holding `refs/tags/o-r/run-4` and `refs/heads/live/o-r/run-6`, a launch without `--run` takes run 7. M3. With neither the setting nor `--evidence-repo`, the launch is refused with a message naming `evidence`, `~/.ultrapowers/fleet.json` and `node fleet/doctor.mjs`, and no push and no `new` was issued. M4. With the evidence repository holding no `o-r` ref and the target holding `refs/tags/ultra/evidence/run-2`, the launch is refused with a message naming `migrate-evidence.mjs`, and no push and no `new` was issued. M5. With `integrations list` naming `gh-o-r` and not `gh-ops-evidence`, the launch is refused with a message naming `gh-ops-evidence`, and no push and no `new` was issued. M6. Under `--evidence-repo ops/other` (setting `ops/evidence`) the plan commit is pushed to `ops/other` and the setup script the `new` verb carries names `ops/other`; the `new` verb's comment carries no `evidence=` token either way. M7. `renderSetupScript({ run: '7', evidence: 'ops/evidence', ...readFleetFiles() })` contains the line `printf '%s\n' 'ops/evidence' >"$HOME/fleet-evidence-repo"` and is at most `SETUP_SCRIPT_BUDGET_BYTES` long; it throws for an `evidence` that is absent or not `<owner>/<repo>`. M8. A live run of the same plan is found by reading that run's `runs/<slug>/<N>/plan.md` on its live branch in the evidence repository: `fleet/tests/test_launch_duplicate.mjs` refuses the duplicate with the plan held only there.

**Authorized-by:** #1395; the operator's picks of 2026-09-29 and their ruling of the same day (the operator's setting, carried by the first-boot setup script)

**Interfaces:**
- Consumes: `evidenceRepoFor(config, override = null) -> string | null`
- Consumes: `readEvidenceSetting({ path } = {}) -> Promise<string | null>`
- Consumes: `runFolderFor(target, run) -> string`
- Consumes: `liveBranchFor(target, run) -> string`
- Consumes: `evidenceUrlFor(repo) -> string`
- Consumes: `highestRunInEvidence(exec, repoDir, evidenceRepo, target) -> Promise<number>`
- Produces: `renderSetupScript({ run, evidence, bootstrap, unit }) -> string`

**Context:** Shared literals (#1395): the evidence repository is the operator's setting, `evidence` in `~/.ultrapowers/fleet.json` (read with `readEvidenceSetting({ path: opts.config })`, or `config.evidence` when a sim injects `config`, exactly as `account` is read at `fleet/launch.mjs:568-580`), overridden by `--evidence-repo <owner>/<repo>` (add `evidence-repo` to `LAUNCH_FLAGS` ~130 and the usage line ~104); resolve it with `evidenceRepoFor`. Nothing derives it from the target; a launch with neither is refused before any read that mutates, naming `"evidence"` in `~/.ultrapowers/fleet.json`, `--evidence-repo` and `node fleet/doctor.mjs`. Its integration is `gh-<owner>-<repo>`; the check at ~748-755 also requires `githubIntegrationFor(evidence)` and refuses naming it. A run's folder is `runs/<slug>/<N>/` (`<slug>` = `targetSlug(target)`), its live branch `live/<slug>/run-<N>`, its tag `<slug>/run-<N>`. Nothing but `ultra/integration-run-<N>` is written to the target; nothing is written to the evidence repository's `main` (a hand archive lives there under `archive/`). `commitPlan` (~1153) builds a parentless commit (temp index, no `read-tree` of base, `commit-tree` with no `-p`) whose tree is `runs/<slug>/<N>/plan.md`, `kata.json` when the hub filed it, `gate-verdicts.json` when the plan has a sibling record, in the target clone's object store, message `ultrapowers plan <owner>/<repo> run-<N> base <base sha>`; `pushPlan` (~1216, `PUSH_ATTEMPTS=3`) pushes `<sha>:refs/heads/live/<slug>/run-<N>` to `evidenceUrlFor(evidence)`, and its race re-read is `highestRunInEvidence`; `--run N` still pushes once. Numbering (~845): `highestRunInEvidence + 1`; when that reading is 0 and `highestRunOnTarget` (kept) is above 0, refuse before any push or VM naming `node fleet/migrate-evidence.mjs --target <owner>/<repo>`. `liveDuplicatesOf` (~473-492) fetches `liveBranchFor(target, row.run)` from the evidence URL and reads `runs/<slug>/<N>/plan.md` there. The janitor call at ~802 passes `evidence` (the janitor reads the setting itself only when it is not handed one). The comment is unchanged — no `evidence=` key. The VM learns the repository from the first-boot setup script: `renderSetupScript` (`fleet/setup-script.mjs` ~81) takes `evidence`, refuses (throws) one that is absent or not `<owner>/<repo>` (it lands inside a single-quoted shell literal), and writes it, beside the bootstrap and unit, with exactly the line `printf '%s\n' '<owner>/<repo>' >"$HOME/fleet-evidence-repo"` — the boot reads `$FLEET_HOME/fleet-evidence-repo` (`FLEET_HOME` is `/home/exedev`, the setup script's `$HOME`). The script is 7591 bytes at base (run 277, measured 2026-09-29) against a budget of 9216. The returned record carries `evidence` and `liveBranch` in place of `planBranch`/`evidenceBranch`; the `new` failure message names the live branch. The sims: `pointAtOrigin` in `_lobby_helpers.mjs` maps every `github.com` URL to the target's bare origin — add a second local bare (`makeEvidenceRepo`, `main` seeded) and route the evidence URL to it; every launch sim's injected `config` gains `evidence` (use `ops/evidence`, an owner unlike the target's) and its `integrations list` answer gains `gh-ops-evidence`; `test_launch_plan_path.mjs` (d) reads the gate record from the evidence bare's live branch; `test_launch_duplicate.mjs` seeds its live run's plan on the evidence bare. `test_launch_credential.mjs` (i) reads `fleet/CONTRACT.md` for `no-rotate` and `usage: <account> 7d`; leave that leg. Every sim prints `ALL TESTS PASSED`, opens no socket and names no sibling sim.

**Proof:**
- Run: node fleet/tests/test_launch_evidence.mjs | grep -q 'ALL TESTS PASSED' [M1, M2, M3, M4, M5, M6]
- Run: node fleet/tests/test_setup_script_evidence.mjs | grep -q 'ALL TESTS PASSED' [M7]
- Run: node fleet/tests/test_launch_duplicate.mjs | grep -q 'ALL TESTS PASSED' [M8]
- Run: node fleet/tests/test_launch_plan_path.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_launch_credential.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_launch_one_engine.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_launch_probe_runners.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_launch_stories_grammar.mjs | grep -q 'ALL TESTS PASSED'
- Legs: (a) one parentless commit on the evidence live branch, tree exactly the two run-folder files, message naming target and base, target refs unchanged [M1]; (b) run 7 over an evidence tag at 4 and a live branch at 6 [M2]; (c) the no-setting refusal naming the key, the file and the doctor, nothing pushed, no `new` [M3]; (d) the migration refusal, nothing pushed, no `new` [M4]; (e) the missing evidence integration refusal naming `gh-ops-evidence`, nothing pushed, no `new` [M5]; (f) the override takes the push and the setup script, and no comment carries `evidence=` [M6]; (g) the setup script's line byte-exact, within budget, and refusals for an absent or malformed repository [M7]; (h) the duplicate refusal with the plan read from the evidence repository [M8].

**Stale-if:**
- path-absent: `fleet/launch.mjs`
- issue-closed: #1395

### Task 3: The sandbox keeps the record in the evidence repository and tags every end

**Type:** implementation

**Files:**
- Modify: `factory/boot.sh`
- Modify: `fleet/tests/_boot_helpers.mjs`
- Modify: `fleet/tests/test_factory_boot.mjs`
- Modify: `fleet/tests/test_factory_publish.mjs`

**Claim:** A run keeps its record in its own folder of the operator's evidence repository and leaves one tag there however it ends. (derived)
Machine: M1. On a clean run `N` of target `o/r` whose `$FLEET_HOME/fleet-evidence-repo` names `ops/evidence`, the evidence repository ends holding the tag `o-r/run-N`, whose tree under `runs/o-r/N/` is exactly `engine.log`, `events.jsonl`, `plan.md` and `status.json`, with `status.json` `state` `done`; `refs/heads/live/o-r/run-N` is gone; and the target's refs are exactly `refs/heads/main` and `refs/heads/ultra/integration-run-N`. M2. On a run whose engine exits 3, the evidence repository holds the tag `o-r/run-N`, its `runs/o-r/N/status.json` says `state` `failed`, and `refs/heads/live/o-r/run-N` is gone. M3. The pull request body carries exactly the line `**Evidence:** https://github.com/ops/evidence/tree/o-r/run-N/runs/o-r/N`. M4. When the evidence repository holds a tag `o-r/run-M` with `M` below `N`, the engine is started with `--past-dir <dir>` whose basename is the highest such `M` and whose `status.json` is byte-equal to `runs/o-r/M/status.json` at that tag; with no such tag the engine is started with no `--past-dir`. M5. With no `$FLEET_HOME/fleet-evidence-repo`, the boot exits non-zero with a `fleet-boot.log` line naming `fleet-evidence-repo`, and the target's refs are unchanged. M6. A publishing run's `publish.json`, `publish-deploy.log` and `publish-verify.log` are in `runs/o-r/N/` at the run's tag.

**Authorized-by:** #1395; the operator's picks of 2026-09-29 and their ruling of the same day (the first-boot setup script carries the repository)

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** Shared literals (#1395): the evidence repository is the operator's, written by the first-boot setup script as one line `<owner>/<repo>` in `$HOME/fleet-evidence-repo` — the boot reads `$FLEET_HOME/fleet-evidence-repo` (same file; `FLEET_HOME` is `/home/exedev`), checks it with `is_target`, and `fail`s naming that path when it is absent or malformed; nothing derives it from the target and the comment carries no `evidence=` key (leave `parse_assignment`'s unknown-key refusal as it is). The slug is the TARGET's, `<owner>-<repo>` (`${TARGET_REPO/\//-}`). A run's folder is `runs/<slug>/<N>/` (plan files and every record file), its live branch `live/<slug>/run-<N>`, its one tag `<slug>/run-<N>`. The plan commit (`plan=`) is a parentless commit in the evidence repository whose tree is that folder with `plan.md`, `kata.json` when filed and `gate-verdicts.json` when present, pushed by the launcher to the live branch. Nothing but `ultra/integration-run-<N>` is written to the target; nothing to the evidence repository's `main` (a hand archive under `archive/`). What changes in `factory/boot.sh`: `parse_assignment` (~104-127) sets `EVIDENCE_REL="runs/$SLUG/$RUN_N"` and `LIVE_BRANCH="live/$SLUG/$RUN_ID"`, and the evidence file is read right after it. `prepare()` (~130-143) no longer fetches a plan branch from the target: `$EVIDENCE_DIR` becomes a shallow single-branch clone of `https://$GITHUB_INT_HOST/$EVIDENCE_REPO.git` at the live branch (the edge routes by repository path; never fetch the whole repository), whose tip on a fresh clone must equal `plan=` (else `fail` naming the branch); `plan.md` is read at `$PLAN_SHA:$EVIDENCE_REL/plan.md`, and `board_up` (~221) reads `kata.json` at `$PLAN_SHA:$EVIDENCE_REL/kata.json` from the evidence clone. `evidence_commit` (~171-189) pushes and rebases on the live branch (keep `add -f`). `record_tags` (~521-535) becomes one tag `refs/tags/$SLUG/$RUN_ID` at the evidence HEAD, verified with `git ls-remote --tags origin`, then `push origin --delete refs/heads/$LIVE_BRANCH`; it runs at publish's end, on the parked path and from `fail()` (~91-99, after its evidence commit, only when `EVIDENCE_READY`). The previous run: after `prepare`, `ls-remote --tags origin 'refs/tags/<slug>/run-*'` on the evidence clone, the highest `M` below `N`, `fetch --depth=1` of that tag, its `runs/<slug>/<M>/` extracted to `$FLEET_HOME/past/<M>`, and `run_engine` passes `--past-dir $FLEET_HOME/past/<M>`; any miss is one `log` line and no flag (the engine reads `status.json`, `events.jsonl` and `red-checks.json` from that directory and takes `M` from its basename). `pr_body` (~292) passes `--evidence "https://github.com/$EVIDENCE_REPO/tree/$SLUG/$RUN_ID/$EVIDENCE_REL"`. The header comment (lines 2-6) names the new shape. The rig (`_boot_helpers.mjs`): `buildOrigin` today pushes the plan to the target's `refs/heads/ultra/plan-run-<N>` (~137); the target bare now holds only `main`, a second bare (the evidence repository, `main` seeded) takes the parentless plan commit on `refs/heads/live/o-r/run-<N>`, and each case writes `<home>/fleet-evidence-repo` as the setup script would (use `ops/evidence`, an owner unlike the target's); `GITHUB_INT_HOST` is `stub.invalid`, so the case's HOME `.gitconfig` maps `https://stub.invalid/ops/evidence.git` to the local bare with `url.<path>.insteadOf`; the `systemd-run` stub records the engine's argv (for example to `$FLEET_HOME/engine-argv`). Pins to move in `test_factory_boot.mjs`: the reads at the evidence branch and tags (~127, 177, 194, 340, 405), the tag and branch legs (~234-255), the run-folder file list (~281-289, now with `plan.md`), the PR body's evidence line (~220), and case (c), which asserted that no tag is ever cut and now asserts the failed tag (M2). In `test_factory_publish.mjs` (~155-160, 223-234, 374) the run folder moves the same way. Every sim prints `ALL TESTS PASSED`, opens no socket and names no sibling sim.

**Proof:**
- Run: node fleet/tests/test_factory_boot.mjs | grep -q 'ALL TESTS PASSED' [M1, M2, M3, M4, M5]
- Run: node fleet/tests/test_factory_publish.mjs | grep -q 'ALL TESTS PASSED' [M6]
- Run: bash -n factory/boot.sh
- Legs: (a) the clean run's tag, its four run-folder files, `state` `done`, the live branch gone and the target holding only `main` and the integration branch [M1]; (b) the failed run's tag with `state` `failed` and the live branch gone [M2]; (c) the evidence line byte-exact [M3]; (d) `--past-dir` at the highest earlier run with its status byte-equal, and no flag without an earlier tag [M4]; (e) the missing evidence file fails the boot with a line naming it and nothing on the target [M5]; (f) the three publish files in the run folder at the tag [M6].

**Stale-if:**
- path-absent: `factory/boot.sh`
- issue-closed: #1395

### Task 4: The engine reads the previous run from a directory

**Type:** implementation

**Files:**
- Modify: `factory/flock/engine.mjs`
- Create: `fleet/tests/flock_past_probe.mjs`

**Claim:** A run briefs its builders on the previous run from the folder the sandbox hands it. (derived)
Machine: M1. Given `--past-dir <dir>` whose basename is `41`, holding a `status.json` with `state` `parked` and an `events.jsonl` with one `terminal` row, on a target clone that has no remote, the engine writes `past.json` in its run dir with `run` `41` and at least one item. M2. Given no `--past-dir`, the engine writes no `past.json`. M3. The string `ls-remote` occurs zero times in `factory/flock/engine.mjs`.

**Authorized-by:** #1395; the operator's picks of 2026-09-29

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The PAST block of `factory/flock/engine.mjs` (~1012-1047) today runs `git ls-remote --tags origin 'refs/tags/ultra/evidence/run-*'` in the target clone, fetches the highest tag below this run and `git show`s `status.json`, `events.jsonl` and `red-checks.json` under `.ultrapowers/runs/<M>/`. Replace it with a read of the directory `--past-dir <dir>` (read with the file's own `arg('past-dir')`): `M` is the directory's basename, `status.json` and `events.jsonl` are required, `red-checks.json` is optional (null when absent), and `pastItems` (`factory/flock/past.mjs`, pure) is unchanged; the `past` event, the `past.json` file and the one `log` line keep their shapes. No `--past-dir` means no read at all. Any failure is still one `log('past: nothing read — …')` line. The sandbox (`factory/boot.sh`) now picks the previous run's tag in the operator's evidence repository and extracts its folder to `$FLEET_HOME/past/<M>` before it starts the engine; the engine no longer runs git for it. The comment above the block names the new source. `fleet/tests/flock_past_probe.mjs` (not a bridged sim: its name does not match `test_*.mjs`) follows `fleet/tests/flock_record_probe.mjs`: a throwaway target in a temp dir with no remote, a one-task plan, the scripted builder (`--builder scripted:<file>`), `ULTRAPOWERS_FLEET_RUN=run-42` and `TYPESAFE_BASE_URL` empty; it runs the engine once with `--past-dir <tmp>/past/41` (a `status.json` `{"state":"parked","phase":"probe"}` and one `{"kind":"terminal","pr":"draft","why":"probe"}` row) and once without, and prints one JSON line `{"with": {"exit": <code>, "past_run": <past.json run or null>, "items": <past.json items length or 0>}, "without": {"exit": <code>, "past_json": <whether past.json exists>}}`, exiting 1 only when it could not run.

**Proof:**
- Run: node fleet/tests/flock_past_probe.mjs | python3 -c "import json,sys; d=json.load(sys.stdin); assert d['with']['past_run'] == 41 and d['with']['items'] >= 1, d" [M1]
- Run: node fleet/tests/flock_past_probe.mjs | python3 -c "import json,sys; d=json.load(sys.stdin); assert d['without']['past_json'] is False, d" [M2]
- Run: test "$(grep -c ls-remote factory/flock/engine.mjs)" = 0 [M3]
- Legs: (a) `past.json` names run 41 with at least one item, read from the directory on a clone with no remote [M1]; (b) no `past.json` without the flag [M2]; (c) no `ls-remote` left in the engine [M3].

**Stale-if:**
- path-absent: `factory/flock/past.mjs`
- issue-closed: #1395

### Task 5: The janitor and the close-out read and finish runs in the evidence repository

**Type:** implementation

**Files:**
- Modify: `fleet/janitor.mjs`
- Modify: `fleet/close-out.mjs`
- Create: `fleet/tests/test_janitor_evidence.mjs`

**Claim:** The janitor and the close-out read a run's record, and write its end, in the operator's evidence repository. (derived)
Machine: M1. For a fleet VM carrying run `5` on target `o/r`, with the setting `ops/evidence` and the hub unable to answer, the janitor reads `gh api repos/ops/evidence/contents/runs/o-r/5/status.json?ref=o-r/run-5` and then `?ref=live/o-r/run-5`, and issues no `gh api` path beginning `repos/o/r/contents/`. M2. When that VM is dead and its page says `running`, the death write PUTs `repos/ops/evidence/contents/runs/o-r/5/janitor-journal.txt` and `repos/ops/evidence/contents/runs/o-r/5/status.json` with `branch=live/o-r/run-5`, then creates `refs/tags/o-r/run-5` in `ops/evidence` and deletes `heads/live/o-r/run-5` there. M3. The orphan close-out lists `repos/ops/evidence/git/matching-refs/heads/live/o-r/run-`. M4. `closeOut({ target: 'o/r', run: 5, evidence: 'ops/evidence' })`, with no VM carrying the run and a live page, PUTs a `status.json` with `state` `failed` to `live/o-r/run-5` in `ops/evidence`, creates `refs/tags/o-r/run-5`, deletes `heads/live/o-r/run-5`, and issues no `git ls-remote`. M5. `janitor` handed no `evidence` reads the setting from its config file: a config naming `ops/other` sends the status reads to `repos/ops/other/contents/runs/o-r/5/status.json`. M6. `janitor` with no setting at all issues no `gh api` path containing `contents/runs/` or `matching-refs/heads/live/`, and its result's `evidence` is `null`.

**Authorized-by:** #1395; the operator's picks of 2026-09-29 and their ruling of the same day (laptop tools read the operator's setting)

**Interfaces:**
- Consumes: `evidenceRepoFor(config, override = null) -> string | null`
- Consumes: `readEvidenceSetting({ path } = {}) -> Promise<string | null>`
- Consumes: `runFolderFor(target, run) -> string`
- Consumes: `liveBranchFor(target, run) -> string`
- Consumes: `runTagFor(target, run) -> string`
- Consumes: `runOfEvidenceRef(target, ref) -> number | null`
- Produces: `sealRun({ exec, evidence, target, run }) -> Promise<{ tagged: boolean, deleted: boolean }>`
- Produces: `janitor({ argv, exec, now, kata, kataEnvPath, evidence, configPath })`

**Context:** Shared literals (#1395): the evidence repository is the operator's setting, `evidence` in `~/.ultrapowers/fleet.json` (read with `readEvidenceSetting`), never derived from the target and never read off a VM comment; a run's folder is `runs/<slug>/<N>/` (the TARGET's slug), its live branch `live/<slug>/run-<N>`, its tag `<slug>/run-<N>`. There is no fallback to the target's refs. Nothing writes to the evidence repository's `main`. `janitor()` (~735) takes `evidence` (the launcher's reap at `fleet/launch.mjs` ~802 hands it the launch's repository) and `configPath`; handed none, it reads the setting from `configPath` (default `DEFAULT_CONFIG_PATH()`) — the comment at ~743 that says the janitor reads no `fleet.json` changes to say it reads this one key. With no setting it reads nothing from any evidence repository, keeps reaping by the hub, and its result carries `evidence: null` (the reap must not stop because a record cannot be read); with one, the result carries it. In `fleet/janitor.mjs`: `contentsPath` (~374) and `readContentsAt` (~386, exported; keep it exported, its caller in `fleet/retire.mjs` goes away in a sibling task) address `repos/<evidence>/contents/runs/<slug>/<N>/<file>`; `evidenceReading` (~401) reads at the tag then the live branch; `writeDeath` (~544-599) PUTs both files to the live branch and, once the status PUT is applied, calls `sealRun`; `evidenceRefsPath` (~618) and `closeOutOrphans` (~700-725) list the evidence repository's `git/matching-refs/heads/live/<slug>/run-` and read runs with `runOfEvidenceRef`; the report line at ~892 names the live branch. The integration-branch reads (`integrationRunsOf`, `decidingPull`, `closedUnmergedBranches`) stay on the target, unchanged. In `fleet/close-out.mjs` (~40-101): the page is read and written at the live branch in the evidence repository, and the `retire` sweep (and `import { retire }`) is replaced by `sealRun`, exported here so the janitor imports it (the janitor imports this file, never the reverse). `closeOut` takes `evidence`; the CLI takes `--evidence-repo`, else the setting, else refuses naming `evidence` in `~/.ultrapowers/fleet.json`. `sealRun` cuts the tag through GitHub's refs API — `gh api repos/<evidence>/git/ref/heads/live/<slug>/run-<N>` for the head sha, `gh api -X POST repos/<evidence>/git/refs -f ref=refs/tags/<slug>/run-<N> -f sha=<sha>` (an answer that the reference already exists is the tag being there), a read of `git/ref/tags/<slug>/run-<N>` to verify it names that sha, and only then `gh api -X DELETE repos/<evidence>/git/refs/heads/live/<slug>/run-<N>`; any refusal keeps the branch and says so on the result. `fleet/tests/test_janitor_evidence.mjs` drives `janitor({ argv: ['--json'], exec, kata: null, now, … })` and `closeOut` with a recording exec stub (lobby `ls`, the unit reads over ssh, and `gh api` answers keyed by path) and config files in a temp dir, asserts on the recorded calls, prints `ALL TESTS PASSED`, and opens no socket.

**Proof:**
- Run: node fleet/tests/test_janitor_evidence.mjs | grep -q 'ALL TESTS PASSED' [M1, M2, M3, M4, M5, M6]
- Legs: (a) the tag read then the live-branch read in the evidence repository, and no read of the target's contents [M1]; (b) the two PUTs on the live branch, then the tag created and the live branch deleted [M2]; (c) the orphan listing names the evidence repository's live prefix [M3]; (d) the close-out writes `failed`, tags, deletes the live branch and runs no `ls-remote` [M4]; (e) the setting read from the config file steers the reads [M5]; (f) no setting, no evidence read, and `evidence` null on the result [M6].

**Stale-if:**
- path-absent: `fleet/close-out.mjs`
- issue-closed: #1395

### Task 6: Retire keeps only its integration-branch sweep

**Type:** implementation

**Files:**
- Modify: `fleet/retire.mjs`
- Create: `fleet/tests/test_retire_integration_only.mjs`

**Claim:** Retiring a product repository's leftovers deletes only the run pull-request branches that were closed without merging. (derived)
Machine: M1. Over a target whose listing carries `refs/heads/ultra/plan-run-3`, `refs/heads/ultra/evidence-run-3` and `refs/heads/ultra/integration-run-3`, the last with one closed unmerged pull request, `retire({ argv: ['--target', 'o/r'], exec })` issues exactly one mutating call, `gh api -X DELETE repos/o/r/git/refs/heads/ultra/integration-run-3`: no `POST` to `git/refs`, no `PATCH` of a pull request and no DELETE of a plan or evidence branch.

**Authorized-by:** #1395; the operator's picks of 2026-09-29

**Interfaces:**
- Consumes: none
- Produces: `retire({ argv, exec })`

**Context:** `fleet/retire.mjs` today converts each run's `ultra/plan-run-<N>` and `ultra/evidence-run-<N>` branches into the tags `ultra/plan/run-<N>` and `ultra/evidence/run-<N>` (`runsOf` ~133, the status read ~161, `createTag` ~204, `readTags` ~218, the verify and deletes ~395-430) and rewrites closed pull requests' bodies to the tag paths (`rewriteBody` ~240, `pullsToPatch` ~251, `patchPull` ~270). A one-time migration (`node fleet/migrate-evidence.mjs`, a sibling task) now copies those old runs into the operator's evidence repository, and nothing on the target is retired into tags any more: remove the conversion, the status read that gated it and the body rewrite, and keep the integration-branch sweep (`integrationFate` ~291, `integrationSegment` ~305; the highest-numbered pull request decides: open stays, closed with `merged_at` null is deleted, merged stays, none stays) with its one `git ls-remote` listing, its `--dry-run` and its per-run line. Rewrite the header comment to match. The helpers it no longer uses (`planBranchFor`, `evidenceBranchFor`, `planTagFor`, `evidenceTagFor`) stay exported from `fleet/lobby.mjs`. `fleet/close-out.mjs` imports `retire` today; a sibling task removes that import, and `retire` keeps its signature either way. `tests/fixtures/plans/2026-09-07/*retire*.md` are inert parser fixtures; leave them. The sim drives `retire` with a recording exec stub (the `ls-remote` listing, the `pulls?state=all&head=` read), asserts on the recorded mutating calls, prints `ALL TESTS PASSED` and opens no socket.

**Proof:**
- Run: node fleet/tests/test_retire_integration_only.mjs | grep -q 'ALL TESTS PASSED' [M1]
- Legs: (a) exactly one DELETE, of the integration branch, and no tag POST, no PATCH and no plan or evidence DELETE [M1].

**Stale-if:**
- path-absent: `fleet/retire.mjs`
- issue-closed: #1395

### Task 7: The census reads run folders in the evidence repository

**Type:** implementation

**Files:**
- Modify: `skills/ultrawrite/scripts/authoring_census.py`
- Modify: `tests/test_authoring_census.py`

**Claim:** A release census reads every run's record from the operator's evidence repository. (derived)
Machine: M1. `evidence_contents_path('ops/evidence', 'o/r', 5, 'status.json')` is `repos/ops/evidence/contents/runs/o-r/5/status.json?ref=o-r/run-5`. M2. `--fetch o/r --runs 5..5 --into <dir> --evidence-repo ops/evidence` asks `gh api` for exactly the paths `evidence_contents_path('ops/evidence', 'o/r', 5, name)` for `name` in `gate-verdicts.json`, `status.json` and `report.json`. M3. With no `--evidence-repo`, `--fetch` takes the repository from the `evidence` key of `--config <path>` (default `~/.ultrapowers/fleet.json`); with a config that lacks the key it exits 2 with a stderr line naming `evidence` and calls no `gh`. M4. `tests/test_authoring_census.py`'s fetch tests pin the new run-folder paths: the file no longer names `ultra/plan/run-` or `ultra/evidence/run-`.

**Authorized-by:** #1395; the operator's picks of 2026-09-29 and their ruling of the same day (laptop tools read the operator's setting)

**Interfaces:**
- Consumes: none
- Produces: `evidence_contents_path(evidence, target, number, name) -> str`

**Context:** Shared literals (#1395): the evidence repository is the operator's setting, the key `evidence` (value `<owner>/<repo>`) in `~/.ultrapowers/fleet.json`, overridden by `--evidence-repo <owner>/<repo>`; nothing derives it from the target and nothing guesses. A run's folder is `runs/<target-owner>-<target-repo>/<N>/` and its tag `<target-owner>-<target-repo>/run-<N>`; the plan files (`plan.md`, `gate-verdicts.json`, `kata.json`) and the record files (`status.json`, `report.json`, …) are all in that one folder at that one tag. There is no fallback to the target's old `ultra/plan/run-<N>` / `ultra/evidence/run-<N>` tags. In `skills/ultrawrite/scripts/authoring_census.py`: `_contents` (~306) gives way to `evidence_contents_path`, and `fetch_runs` (~338-380) reads the three files there (the gate record first; a run without one is still skipped whole with its stderr line, now naming the tag); `main` (~385) gains `--evidence-repo` and `--config`, resolves the repository before any fetch (flag, else the config's `evidence`, else exit 2 naming the key), and the docstrings name the new place. `tests/test_authoring_census.py` pins the old paths in `plan_path`, `status_path` and `report_path` (~328-338) and in the fetch tests (~491, ~522, ~913); move them to the new paths, pass the repository in the fetch tests, and add the config and refusal cases (config files in `tmp_path`, never the laptop's own). The fake `gh` stays a local script.

**Proof:**
- Run: python3 -c "import sys; sys.path.insert(0, 'skills/ultrawrite/scripts'); from authoring_census import evidence_contents_path as p; assert p('ops/evidence', 'o/r', 5, 'status.json') == 'repos/ops/evidence/contents/runs/o-r/5/status.json?ref=o-r/run-5'" [M1]
- Run: python3 -m pytest -q tests/test_authoring_census.py [M2, M3]
- Run: bash -c "! grep -q -e ultra/plan/run- -e ultra/evidence/run- tests/test_authoring_census.py" [M4]
- Legs: (a) the contents path byte-exact [M1]; (b) the three reads under the named repository [M2]; (c) the config's key steers the reads, and a config without it exits 2 naming `evidence` with no `gh` call [M3]; (d) the census tests name no old tag path [M4].

**Stale-if:**
- path-absent: `skills/ultrawrite/scripts/authoring_census.py`
- issue-closed: #1395

### Task 8: The doctor's evidence row walks the one-time setup

**Type:** implementation

**Files:**
- Modify: `fleet/doctor.mjs`
- Modify: `skills/ultrapowers/references/first-run.md`
- Modify: `fleet/tests/test_doctor_cloudflare.mjs`
- Create: `fleet/tests/test_doctor_evidence.mjs`

**Claim:** The doctor says, step by step, what the operator still has to do before runs can keep their record in the evidence repository. (derived)
Machine: M1. `ROW_IDS` is exactly `exe-dev, capacity, claude, accounts, github, integrations, evidence, verb-drift, kata, cloudflare`, and each id is a `## ` heading of `skills/ultrapowers/references/first-run.md`, and `fleet/tests/test_doctor_cloudflare.mjs` pins those ten ids. M2. `doctor({ evidence: null, exec })` answers the `evidence` row `missing` with a detail naming `"evidence"` and `~/.ultrapowers/fleet.json`, and issues no `gh api repos/` call. M3. With `evidence: 'ops/evidence'` and `gh api repos/ops/evidence` exiting 1, the row is `missing` with a detail naming `gh repo create ops/evidence --private`. M4. With that read answering, the row is `missing` naming `node fleet/target.mjs ops/evidence` when `integrations list` lacks `gh-ops-evidence`; `ok` when it is listed with its policy selector `tag:fleet`; and `missing` naming `gh-ops-evidence` when its selector is anything else. M5. The `capacity` row over config keys `cpu`, `memory`, `account` and `evidence` does not call any of them a key nothing reads.

**Authorized-by:** #1395; the operator's picks of 2026-09-29 and their ruling of the same day (the doctor owns first-run)

**Interfaces:**
- Consumes: `readEvidenceSetting({ path } = {}) -> Promise<string | null>`
- Produces: `doctor({ config, exec, target, configKeys, account, verbsPath, evidence })`

**Context:** Shared literals (#1395): the evidence repository is the operator's setting, the key `evidence` (value `<owner>/<repo>`; the operator's own is `popmechanic/fleet-evidence`) in `~/.ultrapowers/fleet.json`; its exe.dev integration is `gh-<owner>-<repo>` and must carry the policy `tag:fleet` like every other a run needs. The new row, id `evidence`, reported right after `integrations`, checks in order and stops at the first miss, each naming its fix: the key is set (fix: add `"evidence": "<owner>/<repo>"` to `~/.ultrapowers/fleet.json`); the repository exists — `exec('gh', ['api', 'repos/<owner>/<repo>'])` through the doctor's seam, exit 0 (fix: `gh repo create <owner>/<repo> --private`); its integration exists in the one `integrations list` read the doctor already makes (fix: `node fleet/target.mjs <owner>/<repo>`) and its policy, read once with `integrations policy get <name> --json` and judged with the existing `policyRowFor` (~385), is `tag:fleet`. `doctor()` (~808) takes `evidence` the way it takes `account` (the CLI's `main` reads it with `readEvidenceSetting` for the same config path; a sim hands it in); `result.config` stays the two pool keys. The stale-key check in `capacityRow` (~295-325, `READ_KEYS`/`LAUNCHER_KEYS`/`CONFIG_KEYS` ~281-290) learns `evidence`. The `integrations` row is unchanged (the target's object only). `ROW_IDS` (~83) and `first-run.md`'s headings are one pin, so the new `## evidence` section (the three steps and their fixes, the foreign-target case: a run on someone else's repository still records to the operator's own evidence repository) goes in this task; `first-run.md` line 38 also says the record is `runs/<owner>-<repo>/<N>/status.json` in the evidence repository. `fleet/tests/test_doctor_cloudflare.mjs` pins nine ids and nine rows (~85-98); it becomes ten. `fleet/tests/test_doctor_claude.mjs` reads `first-run.md`'s `## claude` section for `seven-day`; keep that. The new sim uses `test_doctor_claude.mjs`'s exec-stub shape (`ssh exe.dev <remote>` keys, `gh api …` keys), prints `ALL TESTS PASSED` and opens no socket.

**Proof:**
- Run: node -e "import('./fleet/doctor.mjs').then(async (m) => { const fs = await import('node:fs'); const doc = fs.readFileSync('skills/ultrapowers/references/first-run.md', 'utf8'); const ids = [...m.ROW_IDS]; if (ids.join(',') !== 'exe-dev,capacity,claude,accounts,github,integrations,evidence,verb-drift,kata,cloudflare' || ids.some((id) => !doc.includes('\n## ' + id + '\n'))) process.exit(1) })" [M1]
- Run: node fleet/tests/test_doctor_evidence.mjs | grep -q 'ALL TESTS PASSED' [M2, M3, M4, M5]
- Run: node fleet/tests/test_doctor_cloudflare.mjs | grep -q 'ALL TESTS PASSED' [M1]
- Run: node fleet/tests/test_doctor_claude.mjs | grep -q 'ALL TESTS PASSED'
- Legs: (a) the ten ids in order, each a heading of the first-run page [M1]; (b) no setting names the key and the file and reads no repository [M2]; (c) an absent repository names `gh repo create` [M3]; (d) the missing integration names `node fleet/target.mjs`, the good policy is ok, an off policy is missing [M4]; (e) `evidence` is not a stale key [M5].

**Stale-if:**
- path-absent: `fleet/doctor.mjs`
- issue-closed: #1395

### Task 9: The one-time migration copies old runs into the evidence repository

**Type:** implementation

**Files:**
- Create: `fleet/migrate-evidence.mjs`
- Create: `fleet/tests/test_migrate_evidence.mjs`
- Create: `fleet/tests/test_migrate_evidence_again.mjs`

**Claim:** The old runs of a product are copied into the evidence repository, one folder and one tag each, without touching the product. (derived)
Machine: M1. With the evidence repository `ops/evidence`, over a target `o/r` holding run 3 as tags only (`ultra/plan/run-3`, `ultra/evidence/run-3`) and run 4 as branches only (`ultra/plan-run-4`, `ultra/evidence-run-4`), the tool pushes the tags `o-r/run-3` and `o-r/run-4` to `ops/evidence`, each on a commit with no parent whose tree is exactly that run's `runs/o-r/<N>/` holding `plan.md` and the run's `status.json` and `events.jsonl`, byte-equal to the target's copies, and prints `run-3: copied`, `run-4: copied` and, last, `total: 2 copied, 0 skipped`. M2. After the tool, every line of the target's `ls-remote` is the same as before it, and the evidence repository's `refs/heads/main` has not moved. M3. A target holding no `ultra/` ref prints `total: 0 copied, 0 skipped` and exits 0. M4. `--dry-run` pushes nothing and prints `run-3: would copy`. M5. A second run over the same target pushes nothing and prints `run-3: skipped`, `run-4: skipped` and, last, `total: 0 copied, 2 skipped`. M6. The CLI with no `--evidence-repo` and a `--config` file lacking `evidence` exits 2 with a line naming `evidence`, having run no `git`.

**Authorized-by:** #1395; the operator's picks of 2026-09-29 and their amendments and ruling of the same day (every past target, idempotence proved on its own, the operator's setting)

**Interfaces:**
- Consumes: `evidenceRepoFor(config, override = null) -> string | null`
- Consumes: `readEvidenceSetting({ path } = {}) -> Promise<string | null>`
- Consumes: `runFolderFor(target, run) -> string`
- Consumes: `runTagFor(target, run) -> string`
- Consumes: `evidenceUrlFor(repo) -> string`
- Consumes: `runOfBranch(ref) -> number | null`
- Produces: `migrateEvidence({ exec, target, evidence, dryRun, urlFor }) -> Promise<{ copied: number, skipped: number, lines: string[] }>`

**Context:** Shared literals (#1395): the evidence repository is the operator's setting, `evidence` in `~/.ultrapowers/fleet.json` (read with `readEvidenceSetting`), overridden by `--evidence-repo <owner>/<repo>`; with neither the CLI refuses (exit 2, naming the key) before any git; nothing derives it from the target. A run's folder is `runs/<slug>/<N>/` (`<slug>` = the TARGET's `<owner>-<repo>`), its tag `<slug>/run-<N>`. The CLI is `node fleet/migrate-evidence.mjs --target <owner>/<repo> [--evidence-repo <owner>/<repo>] [--config <path>] [--dry-run]`, one target per call; the operator runs it per past target — at least `popmechanic/ultrapowers`, `popmechanic/tinyapp-fixture`, `popmechanic/radio-station`, `popmechanic/runroom`, `popmechanic/runroom-ab`, `popmechanic/flock-baseline`, `popmechanic/todo-tags`, `popmechanic/vibecoding-analyzer`, and per-run targets named like `popmechanic/ultrapowers-run-110` (slug `popmechanic-ultrapowers-run-110`). A run is every `N` with an `ultra/evidence/run-<N>` tag or an `ultra/evidence-run-<N>` branch (the tag wins when both exist); its plan files come from `ultra/plan/run-<N>` or `ultra/plan-run-<N>` at `.ultrapowers/plan.md`, `.ultrapowers/kata.json` and `.ultrapowers/gate-verdicts.json` (each when present), its record files from every file under `.ultrapowers/runs/<N>/` at the evidence ref, all landing flat in `runs/<slug>/<N>/`. A target may hold only tags, only branches, both, or no `ultra/` ref at all (a zero total, exit 0). The tool reads with one `git ls-remote <target url> 'refs/heads/ultra/*' 'refs/tags/ultra/*'`, reads the evidence repository's `refs/tags/<slug>/run-*` once, and skips a run whose tag is already there (idempotent); it fetches only the refs it copies (depth 1) into a temporary repository, builds each tree with a temporary index, makes each commit with `commit-tree` and no parent (message `ultrapowers evidence <owner>/<repo> run-<N> (migrated from <ref>)`), and pushes `<sha>:refs/tags/<slug>/run-<N>` to the evidence repository; the temporary repository is removed however it ends. It deletes and moves no target ref, writes no branch in the evidence repository, and never touches the evidence repository's `main` (it holds a hand archive under `archive/`); retiring the target's old tags is a later operator decision. Output: one line per run in ascending `N` — `run-<N>: copied`, `run-<N>: skipped` or, under `--dry-run`, `run-<N>: would copy` — and last `total: <copied> copied, <skipped> skipped`. `urlFor` defaults to `evidenceUrlFor` (`https://github.com/<repo>.git`) for both repositories; the sims pass one that maps `o/r` and `ops/evidence` to local bare repositories built in a temp dir, and write their config files there, so nothing opens a socket or reads the laptop's own config (`fleet/tests/test_sims_are_hermetic.mjs` reads every `test_*.mjs`, and no sim may name a sibling sim). Both sims print `ALL TESTS PASSED`.

**Proof:**
- Run: node fleet/tests/test_migrate_evidence.mjs | grep -q 'ALL TESTS PASSED' [M1, M2, M3, M4, M6]
- Run: node fleet/tests/test_migrate_evidence_again.mjs | grep -q 'ALL TESTS PASSED' [M5]
- Legs: (a) two parentless tagged commits, each tree exactly its run folder with byte-equal files, and the two copied lines and the total [M1]; (b) the target's listing and the evidence `main` unchanged [M2]; (c) the zero total and exit 0 on an empty target [M3]; (d) a dry run that pushes nothing and says `would copy` [M4]; (e) the second run pushes nothing and reports both runs skipped [M5]; (f) no repository named, exit 2 naming the key, no git run [M6].

**Stale-if:**
- path-exists: `fleet/migrate-evidence.mjs`
- issue-closed: #1395

### Task 10: The docs say the operator's evidence repository owns the record

**Type:** implementation

**Files:**
- Modify: `fleet/CONTRACT.md`
- Modify: `fleet/RUNBOOK.md`
- Modify: `skills/ultrapowers/SKILL.md`
- Modify: `.claude/rules/fleet.md`
- Modify: `.claude/rules/factory.md`
- Modify: `README.md`

**Claim:** Anyone reading the docs learns that a run's plan and record live in the operator's evidence repository, how to set it up once, and how to copy old runs there. (derived)
Machine: M1. The first line of `fleet/CONTRACT.md` names `the evidence repository owns the record` and no longer names `the target owns the record`. M2. `skills/ultrapowers/SKILL.md` carries the status read path `contents/runs/<owner>-<repo>/<N>/status.json?ref=<owner>-<repo>/run-<N>`. M3. None of `README.md`, `skills/ultrapowers/SKILL.md`, `.claude/rules/fleet.md` and `.claude/rules/factory.md` names `ultra/plan-run-`, `ultra/evidence-run-`, `ultra/plan/run-` or `ultra/evidence/run-`. M4. `fleet/CONTRACT.md` names each of `live/<owner>-<repo>/run-<N>`, `<owner>-<repo>/run-<N>`, `runs/<owner>-<repo>/<N>/`, `fleet-evidence-repo`, `"evidence"` and `migrate-evidence.mjs --target`. M5. The `## Get started` section of `README.md` names `"evidence"`, `gh repo create` and `node fleet/target.mjs`. M6. `fleet/RUNBOOK.md` names `migrate-evidence.mjs --target` and the doctor's `evidence` row.

**Authorized-by:** #1395; the operator's picks of 2026-09-29 and their ruling of the same day

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** Shared literals (#1395), which replace the old ones everywhere these docs state them: the evidence repository is the operator's own setting — the key `evidence` (value `<owner>/<repo>`; the operator's is `popmechanic/fleet-evidence`, private) in `~/.ultrapowers/fleet.json`, overridden per launch by `--evidence-repo <owner>/<repo>` — never derived from the target; a launch with neither is refused, naming the key and `node fleet/doctor.mjs`. Because the record always goes to the operator's repository, a foreign target (someone else's repository) and another user's fleet both work: a `facebook/react` run lands in `runs/facebook-react/<N>/` of the operator's repository. Its exe.dev integration is `gh-<owner>-<repo>` on `tag:fleet`. The one-time setup is three steps, each a check of the doctor's new `evidence` row (after `integrations`): set the key; `gh repo create <owner>/<repo> --private`; `node fleet/target.mjs <owner>/<repo>` for the integration. A run's folder is `runs/<target-owner>-<target-repo>/<N>/` (plan files `plan.md`, `kata.json`, `gate-verdicts.json` and every record file: `status.json`, `events.jsonl`, `engine.log`, `summary.json`, the engine files, the publish files). The plan commit is a parentless commit in the evidence repository whose tree is that folder with the plan files, its message naming the target and base sha, pushed by the launcher to `live/<owner>-<repo>/run-<N>`; the sandbox commits the record there every 60 s and at each transition, and at the end of every run (done, parked and failed) cuts one tag `<owner>-<repo>/run-<N>` on its last commit, verifies it with `git ls-remote --tags`, and deletes the live branch. The product repository receives only `ultra/integration-run-<N>`. Run numbers come from the evidence repository's `live/<o>-<r>/run-*` branches and `<o>-<r>/run-*` tags; the launcher refuses when the evidence repository holds no ref for the target while the target still holds `ultra/*` refs (run the migration first), and when the evidence integration is missing. The VM learns the repository from the first-boot setup script, which writes it to `$HOME/fleet-evidence-repo`; the boot reads that file and fails without it; the assignment comment is unchanged (no `evidence=`). The sandbox reaches the evidence repository through the same edge host (`https://$GITHUB_INT_HOST/<evidence repo>.git`) and fetches only the live branch, shallow. The engine reads the previous run from a directory the boot extracts (`--past-dir`). The janitor, close-out, census and duplicate check read only the evidence repository, taking it from the setting (the janitor keeps reaping by the hub when the key is unset); retire keeps only its sweep of closed-unmerged `ultra/integration-run-*` branches. The PR body's evidence link is `https://github.com/<evidence repo>/tree/<owner>-<repo>/run-<N>/runs/<owner>-<repo>/<N>`. The migration is `node fleet/migrate-evidence.mjs --target <owner>/<repo> [--evidence-repo <o>/<r>] [--dry-run]`, one target per call, idempotent, deleting nothing on the target; the operator runs it once per past target before the first launch on it. The evidence repository's `main` holds a one-time hand archive under `archive/`; no tool writes to `main`, and runs live only under `runs/`, on `live/*` branches and on the run tags. The rollback is a launch from a checkout made before this plan's merge. Sections to rewrite in `fleet/CONTRACT.md`: the title line, the shape paragraph (lines 11-32), the three-branches and two-tags sections, run id, the comment's `plan=` (now a commit in the evidence repository), the launch sequence, the setup script, the boot, the `status.json` path, integration naming, the doctor rows and the janitor; the contract wins over every other doc. Keep `no-rotate` and `usage: <account> 7d` in `fleet/CONTRACT.md` (a launcher sim reads them). `skills/ultrapowers/references/first-run.md` is the doctor task's (its headings are pinned to the row ids); link to its `evidence` section rather than restating it. `skills/ultrapowers/SKILL.md`'s status command (~187) becomes `gh api 'repos/<evidence repo>/contents/runs/<owner>-<repo>/<N>/status.json?ref=<owner>-<repo>/run-<N>' --jq .content | base64 -d` after the run and `?ref=live/<owner>-<repo>/run-<N>` while it is live. `fleet/RUNBOOK.md` gains the migration procedure (per target, `--dry-run` first) and the one-time setup.

**Proof:**
- Run: head -n 1 fleet/CONTRACT.md | grep -v 'the target owns the record' | grep -q 'the evidence repository owns the record' [M1]
- Run: grep -qF 'contents/runs/<owner>-<repo>/<N>/status.json?ref=<owner>-<repo>/run-<N>' skills/ultrapowers/SKILL.md [M2]
- Run: ! grep -q -e 'ultra/plan-run-' -e 'ultra/evidence-run-' -e 'ultra/plan/run-' -e 'ultra/evidence/run-' README.md skills/ultrapowers/SKILL.md .claude/rules/fleet.md .claude/rules/factory.md [M3]
- Run: for s in 'live/<owner>-<repo>/run-<N>' '<owner>-<repo>/run-<N>' 'runs/<owner>-<repo>/<N>/' 'fleet-evidence-repo' '"evidence"' 'migrate-evidence.mjs --target'; do grep -qF -- "$s" fleet/CONTRACT.md || exit 1; done [M4]
- Run: sed -n '/^## Get started/,/^## [^G]/p' README.md | tr '\n' ' ' | grep -F '"evidence"' | grep -F 'gh repo create' | grep -qF 'node fleet/target.mjs' [M5]
- Run: grep -qF 'migrate-evidence.mjs --target' fleet/RUNBOOK.md && grep -qE 'evidence.? row' fleet/RUNBOOK.md [M6]
- Run: grep -q 'no-rotate' fleet/CONTRACT.md
- Legs: (a) the title line names the evidence repository and not the target [M1]; (b) the status read's path [M2]; (c) none of the four old ref shapes in the four docs [M3]; (d) the six literals in the contract [M4]; (e) the one-time setup's key, repository and integration in the getting-started section [M5]; (f) the migration command and the doctor's evidence row in the runbook [M6].

**Stale-if:**
- path-absent: `fleet/CONTRACT.md`
- issue-closed: #1395
