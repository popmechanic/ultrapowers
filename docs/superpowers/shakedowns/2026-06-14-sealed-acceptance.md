# Sealed acceptance — Task 7 live shakedown

**Date:** 2026-06-14
**Operator:** Marcus (popmechanic)
**Driver:** Claude (Opus 4.8)
**Plan:** `docs/superpowers/plans/2026-06-12-sealed-acceptance.md` (Task 7, manual)
**Spec:** `docs/superpowers/specs/2026-06-12-sealed-acceptance-design.md`
**Scope:** targeted — throwaway `/tmp` repo + a toy spec (`slugify`), four probes hitting agentic
paths that **no pytest covers**. Part 1 (sealed acceptance) is merged and runs on every execution;
this exercises its untested agentic surface. No feature code written; bugs filed as issues, not patched.

## Artifacts exercised (as shipped, main @ c8a3a5c+)

- `skills/ultrapowers/scripts/seal_hash.py` — canonical suite hash (sha256 over sorted path+bytes)
- `skills/ultrapowers/scripts/run_acceptance.sh` — deterministic exam runner (emits one JSON object)
- `skills/ultraplan/references/seal-author-prompt.md` — spec-only sealing author brief
- relay = `BAKE:ACCEPTANCE-EXAM` block baked into `skills/ultrapowers/harnesses/waves.js:916-943`
  (part 2 moved the engine from `workflow.js` to `harnesses/waves.js`)

## Test bed

- Scratch repo: `/tmp/ultra-shakedown/repo` (git, branch `main`), clones `repo2..repo6` for parallel relay runs.
- Toy spec `SPEC.md`: `slugify(text)` — lowercase; runs of non-alphanumerics → single hyphen;
  strip leading/trailing hyphens; `"" → ""`; plus 5 worked examples.
- Baseline state: `slugify.py` a stub raising `NotImplementedError` (feature unbuilt → exam must be RED).
- Vault: `/tmp/ultra-shakedown/vault` (a throwaway vault, not the real `~/.ultrapowers`, to avoid polluting it).
  The runner's `--vault`/`--repo` flags point it at the scratch setup; relay behavior is identical to
  production (those flags are just argv passed through the baked command).

---

## Probe 1 — AUTHOR (live fresh subagent) — **PASS**

Dispatched a fresh-context `general-purpose` subagent (most-capable tier) with the **exact**
`seal-author-prompt.md` brief + only the four inputs (spec text, pytest conventions, base branch `main`,
vault path). It never received the plan, the task list, or this conversation.

Author returned: `sealId cacb7aa47902`, `suiteSha256 cacb7aa47902…540c`, red evidence (20 failed at
baseline, all `NotImplementedError`), and a 20-test / 5-criteria coverage summary. **Suite contents withheld.**

**Independent verification (did not trust narration):**

| Check | Result |
|---|---|
| Vault entry written (`suite/test_slugify.py` + `manifest.json`) | ✓ |
| `seal_hash.py` recomputes recorded hash | ✓ `cacb7aa47902…540c` exact |
| seal-id == first 12 hex of hash | ✓ |
| manifest well-formed (`planPath:null`, `baselineSha`, `redEvidence`≤2000, coverage map) | ✓ |
| **RED confirmed independently** — ran `run_acceptance.sh` against baseline `main` myself | ✓ `status:OK, passed:false, exitCode:1, 20 failed`, all genuine `NotImplementedError` (not suite syntax/import errors) |

→ The agentic sealing flow works end-to-end without the author ever seeing the plan.

### Judgment Moment (A) — operator vouches for the exam

Operator was shown the spec and the plain-English coverage summary **side by side** and asked whether the
exam adequately checks the spec — the core test of whether a non-coder can vouch for an exam they can't read.

- **Outcome:** operator initially could not — *"You've got to give me more precise instructions for reviewing
  this."* A 3-question rubric (everything covered? / invented anything? / your examples present? — none
  requiring code-reading) unblocked them; they then vouched **Yes — adequate**.
- **Finding:** the system ships the coverage summary but **not** the procedure for judging it. Filed as
  [#37](https://github.com/popmechanic/ultrapowers/issues/37) (P3). This is load-bearing for the feature's
  central claim, hence recorded as a finding, not a footnote.

---

## Probe 2 — RELAY (real Haiku, the center of gravity) — **FAIL (6/6 false negatives)**

Implemented `slugify` (real body) and committed, so the exam goes GREEN. Ground-truth direct runner output:

```json
{"sealId": "cacb7aa47902", "status": "OK", "passed": true, "exitCode": 0, "output": "....................   [100%]\n20 passed in 0.01s"}
```

Then dispatched **6 real Haiku agents** with the **exact baked `BAKE:ACCEPTANCE-EXAM` prompt** (waves.js:922-925)
+ the schema `{raw:string}` reproduced as a final-message instruction. Command (per run, against its own clone):

```
bash …/run_acceptance.sh cacb7aa47902 main cacb7aa47902…540c --vault /tmp/ultra-shakedown/vault --repo /tmp/ultra-shakedown/repoN
```

**Every Haiku returned the same thing** (run 1 sequential; runs 2-6 parallel, distinct clones):

```json
{"raw": "....................                                                     [100%]\n20 passed in 0.01s"}
```

That `raw` is the **inner pytest text from the runner JSON's `output` field** — Haiku **unwrapped the
nested JSON object** instead of relaying the runner's actual stdout (the JSON envelope) verbatim.

Replaying the **exact** engine extraction (`waves.js:931-936`, real regex, run in Node) over each captured `raw`:

| run | raw has `{` | `parsed` | engine status | passed | gate Approves? |
|----|----|----|----|----|----|
| 1 | no | null | ERROR | false | **no** |
| 2 | no | null | ERROR | false | **no** |
| 3 | no | null | ERROR | false | **no** |
| 4 | no | null | ERROR | false | **no** |
| 5 | no | null | ERROR | false | **no** |
| 6 | no | null | ERROR | false | **no** |

Truth: exam is GREEN. Result: **6/6 FALSE NEGATIVES** — the gate would refuse to Approve a passing exam every time.

- **Root cause:** the runner emits a JSON object as stdout; the relay agent is asked to embed that JSON-object
  stdout as a *string* in `{raw:string}` (JSON-in-JSON); Haiku systematically unwraps it; the engine regex
  `(raw||'').match(/\{[\s\S]*\}/)` then finds no `{` → `parsed=null` → `status:ERROR`.
- **Severity:** fail-**safe** (this mode can never fabricate `passed:true`, so the anti-gaming property holds),
  but the feature is **unusable on the happy path** — a passing exam never auto-approves. Filed as
  [#36](https://github.com/popmechanic/ultrapowers/issues/36) (P1 usability).
- **Answer to the probe's central question** ("does a real Haiku reliably relay the runner's stdout verbatim,
  and does the regex survive model chatter?"): **No.** The relay is not reliable; the breakage is upstream of
  the regex (the payload to relay is itself JSON), so the regex never gets a chance.

---

## Probe 3 — TAMPER (deterministic) — **PASS**

Flipped one byte in the vaulted suite (`printf ' ' >> test_slugify.py`), reran the runner:

```json
{"sealId": "cacb7aa47902", "status": "SEAL_BROKEN", "passed": false, "exitCode": 1,
 "output": "suite hash c3bdb16a…94c9 does not match recorded cacb7aa47902…540c"}
```

→ `SEAL_BROKEN`, exit 1, mismatch reported verbatim. In the engine, `!acceptance.passed` pushes the
"gate must not Approve" judgment call (waves.js:941-942). Vault byte restored; hash matches again. ✓

## Probe 4 — WAIVER (deterministic) — **PASS**

Compiled a marked plan carrying `**Acceptance:** waived — testing the waiver path`:

- compile exit 0; `acceptance` block = `{"mode":"waived","reason":"testing the waiver path"}`.
- Control: same plan with the line removed → compile exit 1, error names the spec:
  `error: marked plan has no **Acceptance:** line … See docs/superpowers/specs/2026-06-12-sealed-acceptance-design.md`.
- Engine passthrough (waves.js:907-908): `{mode:'waived', reason, passed:null}` → renders in the report. ✓

## Incidental — worktree hygiene — **PASS**

After 6 real relay invocations (each does `git worktree add` + `remove`), all six repos report exactly 1
worktree — `run_acceptance.sh`'s cleanup trap held under live agent use, no leaks.

---

## Verdict

| Probe | Path | Result |
|---|---|---|
| 1 | AUTHOR — agentic spec-only sealing | **PASS** (verified independently) |
| 2 | RELAY — real Haiku administers exam | **FAIL — 6/6 false negatives** ([#36](https://github.com/popmechanic/ultrapowers/issues/36)) |
| 3 | TAMPER — broken-seal detection | **PASS** |
| 4 | WAIVER — compile + carry | **PASS** |
| A | operator vouches for exam | unblocked only after supplying a rubric ([#37](https://github.com/popmechanic/ultrapowers/issues/37)) |

**Net:** the *guarantees* hold — sealing is honest and spec-blind, tampering is caught, waivers carry, and no
failure mode can fabricate a green. But the **happy path is broken**: the relay false-negatives every passing
exam, so sealed acceptance as currently wired would block every legitimate run at the gate. **Do not yet rely
on sealed acceptance for automatic Approve** until [#36](https://github.com/popmechanic/ultrapowers/issues/36)
is fixed and re-shaken. The security thesis survives; the usability does not.

## Filed issues

- [#36](https://github.com/popmechanic/ultrapowers/issues/36) — relay false-negatives every passing exam (P1 usability; not a security hole)
- [#37](https://github.com/popmechanic/ultrapowers/issues/37) — operators need a "how to vouch" rubric with the coverage summary (P3)
