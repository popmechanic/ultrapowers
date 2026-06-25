# Superpowers compatibility check — design

**Date:** 2026-06-25 · **Status:** approved design, pre-plan
**Scope:** replace ultrapowers' loose, advisory superpowers-version check with a
resolver-grounded, contract-based preflight; execute the GA-flip; document one
latent fragility. Engine/skill change → **Acceptance:** suite.

---

## 0. TL;DR

ultrapowers' superpowers "version check" today is an advisory instruction in
`SKILL.md` Step 1 that (a) `ls`-es **one hard-coded cache path**, (b) keys loosely on
the "v6" label, and (c) "warns and continues" no matter what. A diagnostic against the
real 6.0.0→6.0.3 delta showed the check is pointed at the **wrong, disabled** install
and that version numbers are a weak proxy for the thing that actually matters: whether
the superpowers **contract tokens** ultrapowers depends on are still present.

This change:

1. **Resolves the *active* superpowers** from `enabledPlugins` + `installed_plugins.json`
   (not by listing a cache dir).
2. **Asserts the contract** via a single shared token manifest used by both the runtime
   preflight and the pytest tripwire (no duplicate source).
3. **Grades the response:** missing contract token → block-with-human-override; version
   delta only → warn-and-continue with specifics.
4. **Executes the GA-flip:** retires the frozen `tests/fixtures/superpowers-v6/` drift
   baseline in favor of a live-cache tripwire + small synthetic checker fixtures.
5. **Documents** the `.git/ultra` latent fragility (no code move now).

---

## 1. Problem (audit + diagnostic)

### 1.1 The current check
`skills/ultrapowers/SKILL.md` Step 1 (lines ~56–63) instructs the agent to read the
directory name under `~/.claude/plugins/cache/claude-plugins-official/superpowers/`,
compare to "the vendored Superpowers v6 snapshot (dev 08fc48c)," and — verbatim —
"**A different version is not a blocker — warn and continue.**" There is no semver
parsing, no floor/ceiling, no per-token assertion, and no gate. The real structural
checks live only in `tests/test_superpowers_compat.py`, which (a) runs only in CI/the
suite, never at a user's runtime, and (b) reads a **frozen vendored snapshot**, not the
user's installed superpowers (behind the "GA-FLIP SEAM," pending v6 GA).

### 1.2 What the diagnostic found
- The user has **two** superpowers installs: `superpowers@claude-plugins-official`
  (**6.0.3**, `gitCommitSha 363923f…`) and `superpowers@superpowers-marketplace`
  (**6.0.0**, `284be59…`). `~/.claude/settings.json` `enabledPlugins` sets
  `"superpowers@claude-plugins-official": false` — so the **active** superpowers is the
  marketplace **6.0.0**, which matches the session's skill-load path. The old check
  inspects the *disabled* `claude-plugins-official` cache → would report **6.0.3**, the
  wrong install.
- **6.0.3 does not destabilize ultrapowers** (verified three ways): all 14 critical
  contract tokens still pass against the installed 6.0.3; the only changed file in the
  whole skills tree is `subagent-driven-development/SKILL.md`, whose two changed lines
  (SDD progress-ledger path `.git/…/sdd` → `.superpowers/sdd/`, plus a `git clean`
  warning) are internal SDD bookkeeping ultrapowers never reads; ultrapowers reads zero
  SDD scratch files. If anything 6.0.3 *improves* the no-Workflow fallback path.
- **Three real issues surfaced** (none caused by 6.0.3):
  - **(i)** the check reads the wrong/disabled cache (above);
  - **(ii)** the vendored snapshot (`tests/fixtures/superpowers-v6/`, dev `08fc48c`)
    predates the released SDD relocation — the attestation baseline is already stale;
  - **(iii)** ultrapowers parks review packets in `.git/ultra/` — the same protected
    location whose write-denial motivated 6.0.3. It works today (Bash redirection is not
    intercepted the way the file-write tools are; `.git/ultra/` is full of historical
    packets and a write probe succeeded), but it is the identical root cause.

---

## 2. Decisions (locked)

1. **Mechanism — both.** Version signal (cheap context) **and** structural contract gate
   (authority).
2. **Snapshot — GA-flip now.** v6 is released; retire the frozen full snapshot as the
   drift baseline.
3. **Mismatch — graded.** Missing contract token → block with explicit human override;
   version delta only (all tokens present) → warn and continue with specifics.
4. **`.git/ultra` (iii) — document + defer** the code move to a follow-up issue.

---

## 3. Architecture

Three shipped scripts (under `skills/ultrapowers/scripts/`) plus a wiring change to
`SKILL.md` Step 1 and a rewrite of the pytest tripwire. The **token manifest is the
single source of truth**, shipped with the plugin and imported by the test — consistent
with this repo's anti-drift / no-duplicate-parser discipline.

### 3.1 Resolver — `resolve_superpowers.py`
**Job:** determine which superpowers install is *active*, with no hard-coded cache path.

- Read the settings cascade for `enabledPlugins`: `~/.claude/settings.json`, then
  project `.claude/settings.json`, then `.claude/settings.local.json` (later overrides
  earlier).
- Read `~/.claude/plugins/installed_plugins.json` for every `superpowers@<marketplace>`
  entry → `{marketplace, installPath, version, gitCommitSha}`.
- **Active set** = installed superpowers whose `enabledPlugins` value is not explicitly
  `false` (absent ⇒ enabled-by-default; assumption noted in §6).
- Output JSON to stdout: the resolved active install(s). If exactly one → that one. If
  more than one enabled → return all, flagged `ambiguous: true` (the caller checks each
  and reports per-marketplace). If none installed → `{active: null}`.

**Interface:** `python3 resolve_superpowers.py [--claude-home PATH] [--project PATH]`
→ stdout JSON `{ active: [{marketplace, installPath, version, gitCommitSha}], ambiguous }`.
`--claude-home`/`--project` exist so tests can point it at synthetic fixtures.

### 3.2 Contract manifest + checker — `superpowers_contract.py`
**Job:** hold the token manifest and check a superpowers root against it.

- `MANIFEST`: a list of `{ rel_path, token, why }` entries — one per contract dependency
  ultrapowers relies on (ported from the assertions currently inline in
  `test_superpowers_compat.py`: writing-plans template shape, the agentic-workers header
  line, SDD continuous-execution + consent + verdicts + worktrees + model-selection +
  blocked-ladder, implementer status taxonomy, code-reviewer categories, etc.).
- `check(superpowers_root) -> Report` where `Report = { ok: bool, missing: [{rel_path,
  token, why}], checked: int }`. A token whose `rel_path` is absent in the given root is
  reported as missing (not silently skipped) **unless** the root is a partial tree — see
  §6 for the partial-tree rule.
- `TESTED_AGAINST = "6.0.3"` — the latest released version whose contract we have
  verified; drives the version-delta signal. Bumped deliberately when we re-verify a new
  release.

**Interface (consumed two ways):**
- importable: `from superpowers_contract import MANIFEST, check, TESTED_AGAINST`.
- the test imports `MANIFEST`/`check` so there is exactly one token list.

### 3.3 Runtime preflight — `check_superpowers_compat.py` + SKILL.md Step 1
**Job:** the thing SKILL.md Step 1 actually runs.

- Calls the resolver, then `check()` on each active install.
- Prints a human-readable verdict and sets an **exit code**:
  - `0` — all tokens present. If `version != TESTED_AGAINST`, also print a one-line
    advisory ("validated against 6.0.3; you have <Y>; all N contract tokens present").
  - `0` — superpowers not installed / unresolvable: print a skip notice (the main
    workflow path does not need live superpowers; do not block).
  - **non-zero** — one or more contract tokens missing: print exactly which tokens, in
    which files, and why each matters.
- **SKILL.md Step 1 rewrite:** replace the lines-56–63 paragraph with an instruction to
  run this script and act on the result:
  - exit 0 → proceed (relay the advisory if present);
  - non-zero → **stop and surface a human gate**: quote the missing tokens and ask the
    operator to confirm continuing despite the contract break, or abort. This is the
    "block with explicit override," expressed as ultrapowers' single-human-gate idiom.

**Interface:** `python3 check_superpowers_compat.py` → stdout verdict, exit 0/non-zero.

### 3.4 GA-flip — `tests/test_superpowers_compat.py` rewrite
The frozen full snapshot was a stand-in while v6 was unreleased. v6 is released, so:

- **Live drift tripwire:** a test that resolves the active superpowers (via the resolver)
  and runs `check()` against it; **skips** when no cache is present (CI has none). This is
  where genuine upstream-drift detection now lives — against the user's real install.
- **Checker unit tests (CI-deterministic):** two tiny synthetic fixtures under
  `tests/fixtures/` — one **good** (all manifest tokens present) and one **broken** (one
  token removed) — asserting `check()` returns ok / reports the exact missing token. These
  do not drift with upstream releases; they test the *checker*, not superpowers.
- **Manifest-is-single-source test:** assert the test imports `MANIFEST` and holds no
  parallel inline token list.
- **Retire** `tests/fixtures/superpowers-v6/` as the drift baseline; delete it (or keep
  nothing depending on it). Reconcile `ATTESTED_VERSION` → fold into
  `TESTED_AGAINST`; update `test_attested_version_matches_installed` accordingly.
- **SKILL.md attestation wording:** replace "validated against the vendored Superpowers
  v6 snapshot (dev 08fc48c)" with wording that names the runtime contract check and the
  `TESTED_AGAINST` version.

### 3.5 Out of scope — `.git/ultra` note (iii)
Add a short "known fragility" paragraph (in `references/` near the review-package /
worktree notes, or as a comment block) recording that ultrapowers scratch lives under
`.git/` — the protected path superpowers fled in 6.0.3 — that it currently works because
ultrapowers writes via Bash redirection rather than the file-write tools, and that a
future tightening of `.git/` protection would require relocating scratch (e.g. to
`.superpowers/` or a tempdir). File a follow-up issue. **No code move in this change.**

---

## 4. Components & interfaces (summary)

| Unit | Location (shipped) | Input | Output |
|---|---|---|---|
| Resolver | `scripts/resolve_superpowers.py` | settings cascade + installed_plugins.json | active install(s) JSON |
| Manifest+checker | `scripts/superpowers_contract.py` | superpowers root | `Report{ok, missing, checked}` |
| Preflight | `scripts/check_superpowers_compat.py` | (resolver+checker) | verdict + exit code |
| Step 1 wiring | `SKILL.md` | preflight exit code | proceed / human-gate |
| Tripwire + unit tests | `tests/test_superpowers_compat.py` | manifest, fixtures, live cache | pass/skip/fail |

Each unit is independently testable: the resolver against synthetic `--claude-home`/
`--project` trees; the checker against the good/broken fixtures; the preflight by
composing the two; SKILL.md wiring by a text-pin test.

---

## 5. Data flow

```
SKILL.md Step 1
  └─ python3 check_superpowers_compat.py
       ├─ resolve_superpowers.py  → active = [{installPath, version, sha, marketplace}]
       │     reads: ~/.claude/settings.json (enabledPlugins, cascaded)
       │            ~/.claude/plugins/installed_plugins.json
       └─ for each active: superpowers_contract.check(installPath)
             → Report{ok, missing[], checked}
       → exit 0 (+advisory) | exit 0 (skip: none) | exit non-zero (missing tokens)
  └─ agent: proceed | proceed-with-advisory | HUMAN GATE (quote missing tokens)
```

---

## 6. Error handling & edge cases

- **No superpowers installed / `installed_plugins.json` missing:** skip the check, note
  it, proceed (the workflow path is independent of live superpowers).
- **Multiple enabled superpowers:** check each; if any is missing tokens, surface it with
  its marketplace label; `ambiguous: true` is itself reported so the operator knows.
- **Settings cascade & default-enabled:** only an explicit `enabledPlugins` value of
  `false` disables; an absent entry is treated as enabled. (Documented assumption — a
  resolver unit test pins this so a wrong assumption is caught, not silent.)
- **Partial tree / file absent:** the live tripwire checks a full installed cache, so an
  absent `rel_path` is a real miss. The synthetic fixtures are full for the tokens they
  carry. (No partial-snapshot skip logic survives the GA-flip — it existed only for the
  vendored snapshot.)
- **`python3` availability:** SKILL.md already depends on `python3` (compile_plan.py), so
  no new dependency.
- **CI has no cache:** the live tripwire skips; checker unit tests still run and keep CI
  green/meaningful.

---

## 7. Testing & acceptance (**Acceptance:** suite)

New/changed tests, all in `tests/`:

1. **Resolver:** synthetic `--claude-home`/`--project` fixtures → picks the enabled
   install; excludes the `false`-disabled one; honors project-over-user cascade; reports
   `ambiguous` when >1 enabled; `active: null` when none.
2. **Checker:** good fixture → `ok`; broken fixture → `ok: false` with the exact missing
   `{rel_path, token}`.
3. **Single-source:** the compat test imports `MANIFEST`; grep-style assertion that it
   carries no duplicate inline token list.
4. **Live tripwire:** runs against the resolved cache; **skips** cleanly when absent.
5. **SKILL.md wiring pin:** Step 1 invokes `check_superpowers_compat.py` and documents the
   graded block/warn behavior (text-pin in the spirit of `test_recommendation_rubric.py`).
6. **Version reconcile:** `TESTED_AGAINST` and the SKILL.md attestation wording agree
   (replaces `test_attested_version_matches_installed`).

The committed suite is the verification; no held-out exam (engine/skill convention).

---

## 8. Out of scope / follow-ups

- **`.git/ultra` relocation** — documented now (§3.5), code move deferred to a tracked
  issue.
- **Pinning by `gitCommitSha`** — the resolver surfaces the sha; gating on it (tighter
  than version) is a possible future hardening, not in this change.
- **Auto-switching/repairing a disabled-vs-enabled superpowers mismatch** — out of scope;
  the check reports, it does not mutate the user's plugin config.
