# Eval-kit reader consolidation (#139 + #140)

_Spec 2026-08-10. One plan covers docket entries #139 and #140._

## Problem

Two defects from PR #138's adversarially-verified review, one drift family:

1. **#139 (CONFIRMED):** `ab_runner.main()` and `run_ab_cell.main()` duplicate the
   identical five-call cell setup (`prepare_engine → install_seals → clone_project
   → seed_workflows → prepare_session_config`). The seam has already drifted once:
   pre-#138, only the run-scoped driver carried the headless fixes, so the two A/B
   entry points ran different setups.
2. **#140 (PLAUSIBLE, measurement-integrity):** the `*.harness.json` manifest
   schema has **three** independent readers — `hooks/session_start.sh` (embedded
   `python3 -c`; parse-guarded; tested), `ab_runner.seed_workflows` (guards
   missing-`file`-key and missing backing file, but its `json.loads` is
   unguarded; untested), and `ultra_run.py`'s install stage (fully unguarded
   `["file"]` index — a malformed manifest tracebacks instead of failing its
   stage). A schema change would land in the hook + its tests while the eval kit
   silently seeds a stale workflow set, so infrastructure drift would masquerade
   as an engine regression in A/B numbers.

The gate-recorded condition on #140 (docket entry Notes, gate 2026-08-10, commit
`869795e`): examine the one-reader option before building a pin test. Examined:
the hook's reader is already Python (an embedded `-c` snippet), so the
cross-language barrier the pin was hedging against does not exist. **This spec
takes the one-reader option; the pin test is never built.**

## Design

### 1. Shared reader: `skills/ultrapowers/scripts/harness_manifest.py` (new, ~25 lines)

One module, one API plus a CLI shim:

```python
def scan(harness_dir):  # -> (files, problems)
```

- `scan` globs `*.harness.json` sorted **by manifest filename** (today's order
  at all three sites) and, per manifest, either appends its `file` value to
  `files` or appends a one-line reason to `problems` ("`<manifest>`: unparseable
  JSON" / "missing `file` key" / "backing file absent"). It never raises.
- Skip-on-problem is today's behavior only at the hook; at the other two sites
  it is **new** semantics — which is why `problems` exists: strict callers
  surface it loudly (§2) so partial schema drift can never be absorbed
  silently. The empty-set hard-fails at those callers already catch total
  drift; `problems` closes the partial-drift hole (one manifest migrated, the
  rest healthy — #140's scenario in miniature).
- `__main__`: `python3 harness_manifest.py <dir>` prints `scan(dir)[0]` one
  name per line and exits 0 — the exact shape the hook consumes today. (No
  separate lax-view function: the CLI is its only consumer.) **`problems`
  never reach stdout** — dropped or stderr only; the hook word-splits stdout
  into filenames, so problem prose there would become fake names the `[ -e ]`
  belt silently absorbs.
- **Backward-tolerance rule, living in `scan`'s docstring** (not only here):
  `seed_workflows` reads manifests inside a *pinned engine worktree* —
  possibly an older schema — with the *checkout's* `scan`, so a schema
  migration **extends** the accepted forms, never replaces them; only a
  manifest unreadable under *any* known form is a `problem`. Otherwise the
  first schema change makes every pre-change engine ref hard-fail in the kit
  — #140's drift-masquerade class, inverted. (Untestable today — one schema
  form exists — hence a docstring rule for the next editor, not a test.)

A future schema change (e.g. `file` becomes an array, an `enabled` filter)
edits `scan`, the `tests/test_harness_registry.py` schema pin, and — see §2 —
`ultra_run.py`'s deliberately-untouched inline reader, all reachable by the
same grep that inventoried them for this spec.

### 2. Two call-site conversions (the third declined — operator-adjudicable)

- **`hooks/session_start.sh`** (the lax caller — session start must never
  break): the embedded snippet (lines 27–36) becomes
  `files="$(python3 "$plugin_root/skills/ultrapowers/scripts/harness_manifest.py" "$harnesses")"`
  — a pure snippet-for-script substitution. The `[ -e "$harnesses/$f" ]` belt
  **stays** (zero cost; keeps the hook's copy step uncoupled from another
  file's semantics). The hook does **not** rely on `scan`'s backing-file
  check — its own belt is its guard; the check's real beneficiary is the kit,
  where the scanned dir is a pinned worktree no CI has vetted. The `|| true` guard wrapper, cmp-skip copy, and
  routing-rule heredoc are untouched (recommendation-rubric drift pin stays
  byte-identical). One named blast radius, predating this change but gaining a
  trigger path (script missing/renamed): when the reader yields nothing,
  `installed_set` stays empty and the orphan GC would delete every installed
  `*.js`. Mitigation adopted: **GC runs only when `installed_set` is
  non-empty** — reader failure becomes a no-op instead of a mass uninstall.
  (The plugin always ships manifests, so empty-and-legitimate does not occur.)
- **`ab_runner.seed_workflows`** (strict): imports via the **existing
  `_SCRIPTS` sys.path block** (ab_runner.py:40-42 — no second insertion), as a
  **hard import** (no `try/except → None` fallback like `seal_hash`'s; a
  missing module must fail loudly, not corrupt the empty-seed message). Calls
  `scan`; hard-fails (existing `sys.exit` style) **before copying anything**
  when `files` is empty **or `problems` is non-empty**, naming the problems —
  a failing cell must not leave a partial seed behind.
- **`ultra_run.py` install stage: deliberately NOT converted** (round-3 trim,
  reverses rounds 1–2; flagged for operator adjudication at spec review). The
  defect class #140 names — *silent* measurement corruption — cannot occur
  there: a malformed manifest crashes the pre-launch driver loudly before any
  run exists, and both the issue's est-files and the gate condition (`869795e`,
  "kit+hook") exclude this file. Converting it bought a receipted stage
  failure instead of a traceback plus a "single runtime reader" tagline, at
  the price of touching the plugin's widest-blast-radius file (every launch)
  and the plan's heaviest new test (an in-process `main()` drive through six
  real stages just to reach the seam). Its inline reader stays crash-loud and
  unguarded; schema migrations reach it via the same grep as the
  `test_harness_registry` pin.

Frozen-periphery check: neither converted file is frozen.

### 3. `prepare_cell` extraction (#139)

```python
def prepare_cell(plan, engine_ref, root):  # -> (workdir, baseline, env)
```

Wraps the five-call chain; both `main()`s call it. `engine` is not returned:
after extraction its only consumers (`seed_workflows`,
`prepare_session_config`) live inside the function; neither `main` uses it
afterward. One deliberate narrowing against issue #139's "six-step" wording:
`build_run_plan` stays duplicated in both mains — `--dry-run` needs the plan
before any execution, so plan resolution cannot move inside `prepare_cell`. `run_ab_cell`'s dirt-seeding
and its `pre = rev(workdir)` capture move to after `prepare_cell`. Two pins:

- **Semantics preservation:** dirt-seeding writes files without committing, and
  `prepare_session_config` never writes into the run repo — its config-path and
  env behavior is pinned by
  `tests/test_ab_runner_isolation.py::test_prepare_session_config_writes_only_inside_workspace`;
  the no-repo-writes half rests on code inspection (it writes only under the
  throwaway config dir) — so `pre` is the same commit in both orderings.
- **Scrub window:** `prepare_cell` seeds a live credential, so in *both* mains
  the `try/finally scrub_credentials` block must begin **immediately after
  `prepare_cell` returns** — `run_ab_cell`'s dirt-seeding happens inside the
  `try`, never between seeding and the `finally` (dirt-seeding can raise; a
  gap would leak the token into a workdir that outlives the run).

## Testing

- New `tests/test_harness_manifest.py`: skips-unparseable, skips-missing-key,
  skips-missing-backing-file (each also asserting the matching `problems`
  entry), sorted-by-manifest-filename order, and the CLI invariant that
  matters: on a `problems`-bearing dir, **stdout carries only filenames**
  (problem prose on stdout would word-split into fake names at the hook). No
  empty-dir CLI case — it pins a shape nothing consumes.
- New `prepare_cell` unit test (in `tests/test_ab_runner.py`): **function-level
  recorder stubs** — monkeypatch the five callees the way the
  `test_bootstrap_cell_*` tests already monkeypatch `prepare_engine` — and
  assert call order and argument threading. (Not subprocess stubs: with
  `subprocess.run` stubbed, `prepare_engine`'s worktree never exists and
  `seed_workflows` would `sys.exit` before the chain completes.) Without this
  the extraction ships with no coverage: `--dry-run` returns before the chain,
  and `run_ab_cell.main` is deliberately never-in-CI.
- Strict-caller coverage: one test for `seed_workflows` asserting a
  `problems`-bearing manifest set fails loudly, naming the manifest, **with
  nothing copied**. (The install-stage strict test died with the declined
  `ultra_run` conversion.)
- Existing `tests/test_session_hook.py` behavior tests keep running the hook
  end-to-end — install, idempotence, GC, routing-context purity stay pinned;
  one new case: GC no-op on reader failure, induced by **prepending a failing
  `python3` shim to an otherwise-full PATH** — NOT a stripped `PATH=/bin`,
  which also loses `basename` and makes the test pass vacuously (empty
  `base` matches the empty `installed_set` pattern, so `rm` is unreachable
  even with the guard deleted). Pre-populate the workflows dir with a `.js`,
  assert it survives; the test must fail when the guard is removed.
- **Not built:** the #140 kit↔hook contract pin — with one reader there is no
  contract between readers to pin.

## Acceptance

**Acceptance:** suite — dev tooling across evals + the session hook; the
committed suite plus existing hook behavior tests are the verification; no
held-out exam.

## Complexity accounting

Deletes two inline manifest readers (hook, kit) and one duplicated five-call
setup sequence; adds one ~25-line module and its unit tests; zero new knobs;
one file deliberately left untouched (`ultra_run.py`, crash-loud inline
reader) to keep the blast radius inside what #140 actually claims. The kit's
strict `problems` check and the hook's GC no-op guard are fail-closed
*preservation* (the hook's mass-delete hazard predates this spec), not new
guard machinery. `complexityEffect: simplification` for both docket entries.

## Trim review

**Author disclosure (Adds/Removes).** Adds: `harness_manifest.py` (`scan` +
`__main__` CLI shim), `prepare_cell`, their unit tests. Removes: three
inline manifest readers, the duplicated five-call setup, the planned #140 pin
test. Surfaces beyond the originating issues: `hooks/session_start.sh`,
`ultra_run.py` install stage (both required by the one-reader goal).

**Reviewer:** fresh-context subagent (seal-author independence model), inputs =
spec + issues #139/#140 + doctrine file + the five touched code files. Verdicts
and adjudication (operator adjudicates at spec review):

| # | Finding | Adjudication |
|---|---|---|
| T1 | `sys.path` insertion duplicates ab_runner's existing `_SCRIPTS` block; import must be hard, not `seal_hash`-style soft | **Adopted** — §2 reuses `_SCRIPTS`, hard import |
| T2 | Keep the hook's `[ -e ]` belt; pure substitution on the riskiest surface | **Adopted** — §2 |
| T3 | "Majority behavior" framing false for parse-skip (1 of 3 readers); argue the new semantics, don't smuggle | **Adopted** — §1 states skip is new at two sites and why `problems` exists |
| U1 | "Existing coverage exercises `prepare_cell`" was FALSE (`--dry-run` returns first; `run_ab_cell` never in CI) | **Adopted** — dedicated unit test added to §Testing |
| U2 | `seed_workflows` "(guarded)" was FALSE for the parse dimension | **Adopted** — §Problem corrected |
| U3 | Skip semantics silently traded the driver's fail-closed crash for a silent partial install | **Adopted** — `scan` returns `problems`; strict callers fail loudly (§1–2) |
| U4 | Hook GC mass-deletes on reader failure; spec added a trigger path without naming it | **Adopted** — blast radius named; GC no-ops on empty `installed_set` |
| U5 | Moving dirt-seeding after `prepare_cell` opens a credential-scrub gap | **Adopted** — scrub-window pin in §3 |
| U6 | "sorted" ambiguous (manifest name vs `file` value) | **Adopted** — sorted by manifest filename |
| U7 | Provenance: #140 condition not in the issue body; PR-transcript claim unciteable | **Adopted** — cites docket gate commit `869795e` and the isolation pin test |

Rejections: none. Scope verdicts: #139 no expansion; #140's four expansions
warranted (hook + driver conversions required by one-reader; driver semantics
now explicit per U3; pin-test deletion is the design's central simplification).

**Round-1 reviewer grade: `netConceptDelta = down`** — two standing concepts
retired ("three independent manifest readers", "kit↔hook contract pin") plus
one duplicated sequence, in exchange for two named functions; graded
down-with-conditions, and both named conditions (U1, U3) are adopted above.

### Round 2 (second independent reviewer, operator-requested)

Fresh-context subagent, same independence model, reviewing the round-1-revised
spec with no knowledge of round 1's dispatch. Verdicts and adjudication:

| # | Finding | Adjudication |
|---|---|---|
| T1 | `harness_files()` lax view has no caller but the CLI — delete it, `__main__` prints `scan(dir)[0]` | **Adopted** — §1, one API + CLI shim |
| T2 | `prepare_cell`'s `engine` return value has no consumer after extraction | **Adopted** — §3 returns `(workdir, baseline, env)` |
| T3 | Hook belt now redundant with `scan`'s backing-file check; don't specify one invariant as load-bearing in two files | **Adopted as wording** — belt kept (round-1 T2), §2 states the hook does not rely on `scan`'s check; the check's beneficiary is the kit's unvetted pinned worktrees |
| U1 | **Cross-version seam:** kit reads *pinned old-engine* manifests with the *checkout's* `scan`; strict `problems` would make pre-change refs unevaluable on the first schema migration | **Adopted** — §1 backward-tolerance contract: migrations extend accepted forms, never replace; only unreadable-under-any-form is a problem |
| U2 | Specified `prepare_cell` test mechanism (subprocess stubs) cannot work — `seed_workflows` would `sys.exit` | **Adopted** — §Testing pins function-level recorder stubs (`test_bootstrap_cell_*` pattern) |
| U3 | Install-stage strict test has no injection seam in `test_ultra_run.py`'s subprocess pattern | **Adopted** — §Testing states the import-and-monkeypatch-`HARNESSES` departure |
| U4 | Hook GC no-op test mechanism unnamed (harness dir can never be empty) | **Adopted** — §Testing pins PATH-without-python3 |
| U5 | Six-vs-five narrowing silent (`build_run_plan` stays duplicated) | **Adopted** — §3 states it and why (`--dry-run`) |
| U6 | Cited isolation pin over-claims; no-repo-writes half rests on code inspection | **Adopted** — §3 citation narrowed |
| U7 | Fourth (test-side) reader `test_harness_registry.py` falsifies "one module is *the* contract" | **Adopted** — §1 qualifier: `scan` is the single **runtime** reader; the test pin also edits on migration |

Rejections: none. Scope verdicts: #139 no expansion (scrub-window pin
warranted); #140's expansions all warranted, with `ultra_run` noted as the
widest-blast-radius file for the narrowest defect.

**Round-2 reviewer grade: `netConceptDelta = down`** — conditioned on U1 and
U2, both adopted above; U1 was the one finding threatening the design's stated
value rather than its write-up.

### Round 3 (third independent reviewer, operator-requested)

Fresh-context subagent, no knowledge of rounds 1–2's dispatches, briefed to
hunt what survives two passes. Verdicts and adjudication:

| # | Finding | Adjudication |
|---|---|---|
| T1 | Drop the `ultra_run.py` conversion + its test: outside the issue's est-files AND the gate condition's "kit+hook"; the silent-corruption class #140 names cannot occur at a crash-loud pre-launch driver; widest-blast-radius file for the narrowest defect | **Adopted as recommendation — OPERATOR-ADJUDICABLE** (reverses rounds 1–2's Option-A breadth); §2 states the decline and its price |
| T2 | Backward-tolerance "contract" is untestable today (one schema form exists) and had no stated physical home | **Adopted** — demoted to a mandated `scan`-docstring rule (§1) |
| T3 | CLI empty-dir test pins a shape nothing consumes | **Adopted** — dropped; replaced by the load-bearing CLI invariant (problems never on stdout) |
| U1 | **GC no-op test as round-2-specified passes vacuously**: `PATH=/bin` loses `basename` too, empty `base` matches the empty `installed_set` pattern, `rm` unreachable even guard-deleted | **Adopted** — mechanism pinned to a failing `python3` shim on a full PATH; test must fail when the guard is removed |
| U2 | Install-stage test mechanism understated (needs a full in-process `main()` drive through six real stages); "departure" claim false — in-file import precedent exists | **Mooted by T1** (test deleted with the conversion); the false "departure" claim removed with it |
| U3 | Backward-tolerance rule's home unstated | **Adopted** — with T2 |
| U4 | CLI `problems` disposal unstated; prose on stdout becomes fake filenames the hook's belt silently absorbs — making the "uncoupled" belt load-bearing | **Adopted** — §1: problems dropped or stderr, never stdout; tested |
| U5 | Strict caller's fail-before-or-after-copy order unstated | **Adopted** — §2: fail before copying; tested |

Rejections: none. Scope verdict adopted wholesale: with T1, the spec's
surfaces now sit exactly inside #140's est-files + the gate condition.

**Round-3 reviewer grade: `netConceptDelta = down` (marginal as reviewed;
clear with T1 adopted)** — reviewer's marginal-value self-assessment: two
findings change the built artifact (U1, U2), one shrinks it (T1), rest
wording — "few but load-bearing, concentrated in the test plan."
