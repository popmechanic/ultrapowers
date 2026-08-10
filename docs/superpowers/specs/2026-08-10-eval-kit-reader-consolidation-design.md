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

One module, which *is* the manifest contract — two entry points, one scan:

```python
def scan(harness_dir):           # -> (files, problems)
def harness_files(harness_dir):  # -> files only (the lax view)
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
- `__main__`: `python3 harness_manifest.py <dir>` prints `harness_files` one
  name per line and exits 0 — the exact shape the hook consumes today; empty
  output only when the directory yields no readable manifests.

A future schema change (e.g. `file` becomes an array, an `enabled` filter)
edits `scan` once.

### 2. Three call-site conversions

- **`hooks/session_start.sh`** (the lax caller — session start must never
  break): the embedded snippet (lines 27–36) becomes
  `files="$(python3 "$plugin_root/skills/ultrapowers/scripts/harness_manifest.py" "$harnesses")"`
  — a pure snippet-for-script substitution. The `[ -e "$harnesses/$f" ]` belt
  **stays** (zero cost; keeps the hook's copy step uncoupled from another
  file's semantics). The `|| true` guard wrapper, cmp-skip copy, and
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
  `scan`; hard-fails (existing `sys.exit` style) when `files` is empty **or
  `problems` is non-empty**, naming the problems.
- **`ultra_run.py` install stage** (strict): same-directory import; calls
  `scan`; the stage fails when `files` is empty **or `problems` is non-empty**,
  naming the problems in the stage detail. This *preserves* the driver's
  fail-closed posture (today one malformed manifest crashes it loudly; a bare
  skip would have turned that into a silent partial install that dies mid-run
  at "Workflow not found").

Frozen-periphery check: none of the three files is frozen.

### 3. `prepare_cell` extraction (#139)

```python
def prepare_cell(plan, engine_ref, root):  # -> (engine, workdir, baseline, env)
```

Wraps the five-call chain; both `main()`s call it. `run_ab_cell`'s dirt-seeding
and its `pre = rev(workdir)` capture move to after `prepare_cell`. Two pins:

- **Semantics preservation:** dirt-seeding writes files without committing, and
  `prepare_session_config` writes only inside the cell workspace (pinned by
  `tests/test_ab_runner_isolation.py::test_prepare_session_config_writes_only_inside_workspace`),
  so `pre` is the same commit in both orderings.
- **Scrub window:** `prepare_cell` seeds a live credential, so in *both* mains
  the `try/finally scrub_credentials` block must begin **immediately after
  `prepare_cell` returns** — `run_ab_cell`'s dirt-seeding happens inside the
  `try`, never between seeding and the `finally` (dirt-seeding can raise; a
  gap would leak the token into a workdir that outlives the run).

## Testing

- New `tests/test_harness_manifest.py`: skips-unparseable, skips-missing-key,
  skips-missing-backing-file (each also asserting the matching `problems`
  entry), sorted-by-manifest-filename order, `__main__` prints one name per
  line and exits 0 on an empty dir.
- New `prepare_cell` unit test (in `tests/test_ab_runner.py`): stub the
  subprocess boundary the way `test_ab_runner_isolation.py` already does and
  assert the five calls happen in order against one workdir. (Without this the
  extraction ships with no coverage: `--dry-run` returns before the chain, and
  `run_ab_cell.main` is deliberately never-in-CI.)
- Strict-caller coverage: one test each for `seed_workflows` and the install
  stage asserting a `problems`-bearing manifest set fails loudly, naming the
  manifest.
- Existing `tests/test_session_hook.py` behavior tests keep running the hook
  end-to-end — install, idempotence, GC, routing-context purity stay pinned;
  one new case: reader yielding nothing ⇒ GC no-op (installed files survive).
- **Not built:** the #140 kit↔hook contract pin — with one reader there is no
  contract between readers to pin.

## Acceptance

**Acceptance:** suite — dev tooling across evals/hook/driver; the committed
suite plus existing hook behavior tests are the verification; no held-out exam.

## Complexity accounting

Deletes two duplicate manifest readers and one duplicated five-call setup
sequence; adds one ~25-line module and its unit tests; zero new knobs. The two
strict `problems` checks and the GC no-op guard are fail-closed *preservation*
(the driver crashes loudly today; the hook's mass-delete predates this spec),
not new guard machinery. `complexityEffect: simplification` for both docket
entries.

## Trim review

**Author disclosure (Adds/Removes).** Adds: `harness_manifest.py` (scan +
lax view + `__main__`), `prepare_cell`, their unit tests. Removes: three
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

**Reviewer grade: `netConceptDelta = down`** — two standing concepts retired
("three independent manifest readers", "kit↔hook contract pin") plus one
duplicated sequence, in exchange for two named functions; graded
down-with-conditions, and both named conditions (U1, U3) are adopted above.
