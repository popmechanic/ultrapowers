# The catch-up meets a real conflict: a run that collides with main holds back

**Grammar:** claims-v1
**Claim:** When a run's change collides with a line main already changed, the run stops short of merging, its pull request stays open, and its status says the catch-up hit a conflict. (elicited)
**Summary:** This is a deliberate test run that edits a line of the project notes that the last release also changed. It exists because the engine's step for catching a finished run up to a newer main has never met a real conflict outside a simulation. You find out, on the real fleet, whether a colliding run holds back instead of merging over main.

**Goal:** Exercise `factory/flock/catchup.mjs`'s conflict path live (map #1292, the 2026-09-29 first-live-catch-up comment): launched on `8dd30474`, before the 0.3.43 release rewrote CLAUDE.md's version line, the run edits that same line, so the self-merge's catch-up onto main must answer `conflict` and park with the pull request open.
**Tech Stack:** Markdown
**Spec:** none — operator pick 2026-09-29 (reap, then prove catch-up)

## Global Constraints

- The run's only edit is to `CLAUDE.md`; the version still lives in both `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`, which this plan does not touch.

### Task 1: The release note stops naming today's version

**Type:** implementation

**Files:**
- Modify: `CLAUDE.md`

**Claim:** CLAUDE.md's release note stops naming today's version, so a release no longer has to edit it. (elicited)
Machine: M1. No line of `CLAUDE.md` names a `0.3.N` version followed by the word `today`. M2. `CLAUDE.md` no longer contains the phrase `both manifests and this line`: a release bumps the two manifests and nothing in CLAUDE.md.

**Authorized-by:** operator pick 2026-09-29; map #1292 (the first live catch-up, 2026-09-29 comment)

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The line to change is the `**Releasing.**` bullet under `## Conventions & gotchas`: it reads "Both `plugin.json` and `marketplace.json` carry the version (`0.3.42` today); `plugin.json` wins silently if they drift" and, two lines on, "bumping both manifests and this line". Keep the bullet's meaning — both manifests carry the version and `plugin.json` wins on drift; a release is one hand PR bumping both manifests — and drop only the parenthesised current version and the words "and this line". Edit nothing else in the file.

**Proof:**
- Run: bash -c "! grep -qE '0\.3\.[0-9]+. today' CLAUDE.md" [M1]
- Run: bash -c "! grep -q 'both manifests and this line' CLAUDE.md" [M2]
- Legs: (a) a grep for any `0.3.N` followed by `today` finds nothing in CLAUDE.md [M1]; (b) the phrase `both manifests and this line` is absent from CLAUDE.md [M2].

**Stale-if:**
- path-absent: `CLAUDE.md`
