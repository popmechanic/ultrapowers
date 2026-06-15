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
   `python3 -m pytest .ultra-acceptance -q`). If the repo's own libraries need
   an editable install or other setup to import (a `kb_lib`-style package, a
   polyglot monorepo), author a one-line `bootstrapCmd` that prepares the
   worktree (e.g. `python3 -m venv .venv && .venv/bin/pip install -e .[dev]`,
   with `runCmd` then invoking `.venv/bin/python -m pytest …`). Leave
   `bootstrapCmd` empty when the bare checkout already imports.
3. Prove RED through the EXACT gate runner — never an ad-hoc pytest call:
   `python3 <plugin>/skills/ultrapowers/scripts/run_acceptance.sh --baseline \
     --suite <vault>/pending/suite --branch <base> --run "<runCmd>" \
     [--bootstrap "<bootstrapCmd>"]`.
   It must report `PROVEN_RED` (exit 0) because the feature is absent. If it
   reports `GREEN_AT_BASELINE`, the spec may already be satisfied — report
   GREEN_AT_BASELINE with the output; do not weaken tests to force red. If it
   reports `EXAM_BOOTSTRAP_ERROR`, fix `bootstrapCmd` until the env prepares.
   Read the output: a `redKind:"collection"` red must fail on the FEATURE's
   own import/symbol — if it fails importing a repo library instead, your
   `bootstrapCmd` is incomplete; fix it and rerun until the only failure is
   the feature.
4. Compute the hash: `python3 <plugin>/skills/ultrapowers/scripts/seal_hash.py <vault>/pending/suite`.
   Rename `<vault>/pending` to `<vault>/<first-12-hex-of-hash>`. Write
   `manifest.json`: { sealId, planPath: null, specPath, suiteSha256, runCmd,
   bootstrapCmd, createdAt, baselineSha, redEvidence (≤2000 chars), coverage:
   [{criterion, tests[]}] }.
5. Remove the worktree. Return ONLY: sealId, suiteSha256, redEvidence,
   coverage summary. Never return suite contents.
