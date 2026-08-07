# Eval-cell config isolation — the eval kit stops writing to the operator's environment

_Design for issue #107 (filed from the live /plugin breakage; distill
2026-08-06 appended that the run's own deferred ack predicted the incident
verbatim)._

## Problem

`evals/ab_runner.py`'s `prepare_engine` pins the engine in a temp worktree,
then registers it with `claude plugin marketplace add` against the
**operator's global config**. The CLI keys registrations on the manifest's
marketplace name — `ultrapowers` — so the add silently overwrites the
operator's real registration; the temp dir later evaporates and `/plugin`
breaks (the #107 incident, repaired by hand).

The uncomfortable detail: the clobber was **load-bearing**. Headless eval
sessions (`claude -p`, no flags beyond output/permissions) inherit the
operator's config, so hijacking where `ultrapowers` points was the only
channel delivering the pinned engine to the session. A rename-only fix breaks
the eval; the channel itself must move. Additionally, script-only cells (the
jsdeps false-BLOCKED cell) call `prepare_engine` and pay the registration
side effect without ever spawning a session.

This is the engine-mutates-operator-environment family (#99's sibling), and
the eval kit is also the natural first conformer to #112's rider (agent-CLI
spawns isolate `CLAUDE_CONFIG_DIR`).

## Design

### 1. `prepare_engine` loses the registration entirely

It returns the pinned worktree and touches nothing else. Script-only cells
(which run `run_acceptance.sh` et al. straight from the worktree) are done —
their side effect is deleted outright.

### 2. Session cells get an isolated config: `prepare_session_config`

New function for cells that spawn `claude -p`:
`prepare_session_config(engine_wt) -> env` creates a throwaway config dir
inside the cell's temp workspace, materializes the pinned engine inside
**it** (registration + enablement run with `CLAUDE_CONFIG_DIR` pointing at
the throwaway), and returns the **complete env mapping** the session cells
use verbatim — `probe_workflow` and `drive_run` consume that one mapping at
their `subprocess.run` sites rather than hand-threading a directory through
three signatures (a forgotten thread at any call site would silently
reproduce #107; a single env source makes the omission hard to write).

The operator's **plugin config** is unwritable by construction for every eval
session — the #107 clobber class dies. Honest residual, named: `install_seals`
still writes the operator-global seal vault (`~/.ultrapowers/acceptance`);
that write is additive-only (it installs seal dirs, never overwrites operator
state) and cannot be redirected one-sidedly because the frozen
`run_acceptance.sh` hardcodes the global vault path — closing it needs an
env override in the frozen runner, i.e. the eval-fixture unfreeze route, and
is out of scope here.

### 3. Verification unknowns, named (the build proves them, in order)

- **Auth under isolation.** On macOS the CLI's credentials live in the
  Keychain, not the config dir — an isolated headless `claude -p` should
  still authenticate. The build verifies with a one-command probe before
  wiring; if auth does NOT survive isolation, stop and surface — the fallback
  (a namespaced marketplace name in the real config, plus explicit teardown)
  is a design change the operator must approve, not a silent substitution.
- **Enablement + dependencies in a virgin config.** The exact incantation
  that makes a fresh config dir load `ultrapowers` from the local marketplace
  headlessly — including whatever onboarding/trust flags headless mode
  requires of a virgin config, **and materializing `superpowers`** (a
  dependency the operator's config provided for free; the ultrapowers-probe
  round-trip does NOT prove it — it exercises only the Workflow tool and the
  pinned plugin). Pass/fail: the probe for the plugin + a one-command skill
  listing (or equivalent) proving superpowers skills resolve, both before any
  drive.
- **Transcript/harvest relocation.** Under an isolated config the session
  transcript lands under the throwaway's `projects/` tree, but
  `_session_transcript` globs `~/.claude/projects/**` and silently falls back
  to the raw result file — quietly zeroing the eval's primary cost metric.
  The harvest globs must derive from the same config dir the session ran
  under, and a missing transcript becomes a **loud failure**, never a
  silent-fallback row.

## Surfaces

- `evals/ab_runner.py` — `prepare_engine` (deletion), `prepare_session_config`
  (new, returns the env mapping), env consumption in
  `probe_workflow`/`drive_run`/`main`, and the harvest path derivation
  (`_session_transcript` + the agent-transcript usage glob) keyed to the
  cell's config dir.
- `tests/` — one subprocess-capture pin (see Testing).

Not built: no engine/gate/skill surfaces; no teardown ceremony (temp configs
are inert garbage, not registrations); no general "deferred acks must gate
releases" machinery — that lesson stays prose in the issue and recurs to the
distill if it bites again.

## Error handling

- Isolation probe fails (no auth / no Workflow round-trip / superpowers
  absent) → the cell aborts with the existing operator-actionable probe
  message.
- `prepare_session_config` failures (worktree missing, registration exit ≠ 0
  inside the throwaway) → cell aborts naming the step. Partial throwaway
  state is explicitly fine — it is disposable garbage; the guarantee that
  matters is free by construction: **no writes to the operator's config,
  ever.**
- Missing session transcript at harvest → loud failure naming the expected
  path; never a silent near-zero-tokens row.

## Testing

- Unit — **one invariant, one pin** (the regression pin issue #107 asked
  for): with subprocess captured/monkeypatched, every `claude` invocation the
  eval kit spawns either does not happen (`prepare_engine` — the deletion
  pin) or carries `CLAUDE_CODE`-relevant env with `CLAUDE_CONFIG_DIR` inside
  the cell workspace (registration, probe, drive alike). No eval code path
  can address the operator's config.
- Live (runbook, next eval run): isolated probe + superpowers check
  round-trip; transcript harvested from the throwaway with real token counts;
  `/plugin` in the operator's session unaffected before/after — the #107
  regression check.

## Trim review

**Author disclosure (Adds/Removes), as drafted.** Adds: one function
(`prepare_session_config`), env threading through three call sites, three
unit-test bullets. Removes: the registration side effect from
`prepare_engine`; the operator-config write channel for all eval sessions.

**Reviewer verdicts** (fresh-context dispatch; saw the draft spec, issue
#107, the doctrine, and `ab_runner.py`): 3 trims + 4 gaps; endorsed the
isolation design over all three of the issue's enumerated directions (the
clobber was load-bearing, so rename-only breaks the eval and save/restore is
the pattern that already failed); grade: **flat**.

**Adopt-or-answer:**

1. Three test bullets → **adopted** (merge): one subprocess-capture pin — no
   eval-spawned `claude` invocation can address the operator's config — which
   is exactly the regression pin the issue asked for.
2. Bare config_dir hand-threaded through three signatures → **adopted**
   (narrow): the helper returns the complete env mapping; call sites consume
   it verbatim (a forgotten thread becomes hard to write).
3. "Whole class retired" overreach vs. `install_seals`' vault write →
   **adopted, prose narrowing** — with the reviewer's stronger option
   (thread `ULTRAPOWERS_VAULT`) **rejected on the merits**: the frozen
   `run_acceptance.sh` hardcodes the global vault path, so redirecting the
   writer without the reader breaks sealed cells; the residual is named in
   the spec with its unfreeze route.
4. **Gap:** transcript/harvest relocation silently zeroes the cost metric →
   **adopted**: named as the third unknown; harvest globs derive from the
   cell's config dir; missing transcript is a loud failure.
5. **Gap:** superpowers dependency absent in a virgin config; the probe is
   not a complete proxy → **adopted**: enablement unknown extended with its
   own pass/fail check.
6. **Gap:** virgin-config onboarding/trust state → **adopted**: folded into
   the enablement unknown.
7. **Gap:** unearnable "no partial writes to any config" guarantee →
   **adopted** (narrow): partial throwaway state is explicitly fine; the
   guarantee that matters — no operator-config writes, ever — is free by
   construction.

**Reviewer grade: flat.**
