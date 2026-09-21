# chore(release): 0.3.32 — one engine: the Jev factory replaces the wave engine, merges its own work, and leaves the hub clean

**Grammar:** claims-v1

**Claim:** After this run 0.3.32 is released: a launch always runs the factory — a run that examines, builds, folds, checks and merges its own work and closes its own issues on the hub — and the old engine is gone from the tree. (elicited)
**Summary:** This is the release of the 2026-09-17 to 2026-09-21 sittings, run through the engine it releases. The Jev factory — the run as a search, judged by literal questions and gated only by exit codes — replaced the wave engine, which was deleted on 2026-09-21 after the factory had merged its own work on this repository and on a TinyApp (runs 36, 37, 197 and 200; n=4 self-merged or held-green runs, under the floor of five, so the deletion stands as an experiment whose rollback is a revert). After it a run you launch and leave stops itself on a red check, folds again when main has moved, closes its issues and gives its sandbox back within the hour.

**Goal:** The 0.3.32 confidence run and release in one plan: bump `plugin.json` and `marketplace.json` to `0.3.32` and the version in `CLAUDE.md`'s Versioning bullet, landed through the merged engine. It is the first run on the engine after cut two (#1183), so its own ending is the release's check: self-merge, the hub closes, the spoke's leave, and — if main moves while it runs — the first re-fold inside a live boot (#1181). What the release carries is in the notes file beside this plan; 0.3.30 and 0.3.31 were manifest bumps that were never tagged, so the notes open at `v0.3.29`.

**Tech Stack:** JSON manifests, Markdown.
Spec: `CLAUDE.md` §Versioning; every fact a worker needs is in the task's Context. The sandbox holds no spec.

## Global Constraints

- Check: git diff --quiet $ULTRA_BASE -- factory fleet skills hooks tests README.md docs
- The two manifests carry the same version string, and nothing but the three files the task names changes.

### Task 1: The plugin is 0.3.32 in both manifests and in its own instructions

**Type:** implementation
**Review:** lean

**Files:**
- Modify: `.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`
- Modify: `CLAUDE.md`

**Claim:** The plugin's version reads 0.3.32 in both places it is written and in the project's own instructions, which still say a release is a plan the fleet runs, merged by the sandbox, then tagged by the operator. (derived)
Machine: M1. `.claude-plugin/plugin.json`'s `version` is the string `0.3.32`, and `.claude-plugin/marketplace.json`'s `plugins[name=ultrapowers].version` is the string `0.3.32`; both files still parse as JSON and the two strings are equal.
M2. `CLAUDE.md`'s Versioning bullet in `## Conventions & gotchas` contains `0.3.32` followed by the word `today`, then the phrase `a release is a fleet plan`, then `gh release create`, and contains `0.3.31` followed by `today` nowhere.
M3. No other key of either manifest changes, and no other sentence of `CLAUDE.md` changes.

**Authorized-by:** `CLAUDE.md` §Versioning and §Working with the operator ("Releases are 0.3.x patches that bundle several merges behind a confidence run"); the operator's word of 2026-09-21 ("0.3.32 behind a confidence run").

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** You see this task body and nothing else. Both manifests carry `"version": "0.3.31"` — `.claude-plugin/plugin.json` at its top-level `version` (line 3) and `.claude-plugin/marketplace.json` inside `plugins[0]`, the `ultrapowers` entry (line 13). Change only those two strings to `0.3.32`; keep each file's indentation, key order and trailing newline exactly. `CLAUDE.md`'s Versioning bullet — the one beginning `**Versioning:** 0.x.y`, in `## Conventions & gotchas` — reads, in one clause, `.claude-plugin/plugin.json` carries `0.3.31` today: the only edit in the whole file is `0.3.31` → `0.3.32` in that clause. Leave every other sentence of the bullet as it is, and do not touch the `## Working with the operator` bullet that says 0.3.28 stabilizes the 0.3 feature set — that sentence is history and stays. There is no exam file for this task: it is proven by the commands below, which the engine runs in your clone after your patch, and a run-wide check holds everything outside these three files byte-identical to the base.

**Proof:**
- Run: python3 -c "import json; a=json.load(open('.claude-plugin/plugin.json'))['version']; b=[p for p in json.load(open('.claude-plugin/marketplace.json'))['plugins'] if p['name']=='ultrapowers'][0]['version']; assert a==b=='0.3.32', (a,b); print(a)"
- Run: sed -n '/\*\*Versioning:\*\*/,/^- \*\*/p' CLAUDE.md | tr '\n' ' ' | grep -q '0\.3\.32.*today.*a release is a fleet plan.*gh release create'
- Run: ! sed -n '/\*\*Versioning:\*\*/,/^- \*\*/p' CLAUDE.md | tr '\n' ' ' | grep -q '0\.3\.31[^0-9]*today'
- Legs: (a) [M1] the first `Run:` line — both manifests parse, the two versions are equal, and they are `0.3.32`; (b) [M2] the second and third `Run:` lines — the bullet reads `0.3.32 … today` before its two phrases, and `0.3.31 … today` is gone; (c) [M3] that nothing else changed in the three files is read against the diff, and that nothing outside them changed is the run-wide check.

**Stale-if:**
- path-absent: `.claude-plugin/marketplace.json`
