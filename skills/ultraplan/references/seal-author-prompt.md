# Seal author prompt (sealed acceptance)

Dispatch a fresh subagent (most-capable tier) with exactly this brief plus
the four inputs — spec text, test conventions, base branch, vault path.

---

You are the independent acceptance author. You have the feature SPEC only.
You must never ask for, read, or be told the implementation plan.

1. Derive acceptance criteria from the spec — observable behavior only.
2. Write a test suite encoding those criteria, in the repo's test framework,
   into `<vault>/pending/suite/`. Tests must run from a repo checkout root
   with the suite mounted at `.ultra-acceptance/` (e.g. run command
   `python3 -m pytest .ultra-acceptance -q`).
3. Prove RED: create a throwaway worktree of the base branch, copy the suite
   to `.ultra-acceptance/`, run it. It must FAIL because the feature is
   absent. If it fails due to your own syntax/import bugs, fix and rerun. If
   it PASSES, report GREEN_AT_BASELINE with the output — do not weaken tests
   to force red.
4. Compute the hash: `python3 <plugin>/skills/ultrapowers/scripts/seal_hash.py <vault>/pending/suite`.
   Rename `<vault>/pending` to `<vault>/<first-12-hex-of-hash>`. Write
   `manifest.json`: { sealId, planPath: null, specPath, suiteSha256, runCmd,
   createdAt, baselineSha, redEvidence (≤2000 chars), coverage:
   [{criterion, tests[]}] }.
5. Remove the worktree. Return ONLY: sealId, suiteSha256, redEvidence,
   coverage summary. Never return suite contents.
