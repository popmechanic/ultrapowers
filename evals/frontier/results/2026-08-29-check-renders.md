# Eval cell: two `--check` renders — P1 blast-radius + P2 referent-existence (#345)

Base: `406080a`. Arms: **A** = `compile_plan.py --check <plan>` (current); **B** = `--check --renders --base <base>` (both renders). Corpus: every `evals/fixtures/*/plan.md` (BASE = the fixture's `project/`; canonical = wide/chained/mixed/degrade/contend) + every `docs/superpowers/plans/2026-08-27-*.md` (BASE = repo root). Produced by `python3 evals/check_renders_ab.py`; numbers below are read by the operator, not asserted by any test.

## Corpus

| Plan | Canonical | exit A | exit B | verdict line identical | blast-radius | referent | +bytes | +lines |
|---|---|---|---|---|---|---|---|---|
| `chained` | yes | 0 | 0 | yes | 0 | 0 | 0 | 0 |
| `contend` | yes | 0 | 0 | yes | 0 | 0 | 0 | 0 |
| `contend-big` | no | 0 | 0 | yes | 0 | 0 | 0 | 0 |
| `contend-prod` | no | 0 | 0 | yes | 0 | 0 | 0 | 0 |
| `degrade` | yes | 0 | 0 | yes | 0 | 0 | 0 | 0 |
| `flawed` | no | 0 | 0 | yes | 0 | 0 | 0 | 0 |
| `flawed-routing` | no | 0 | 0 | yes | 0 | 0 | 0 | 0 |
| `mixed` | yes | 0 | 0 | yes | 0 | 0 | 0 | 0 |
| `webapp` | no | 0 | 0 | yes | 0 | 0 | 0 | 0 |
| `wide` | yes | 0 | 0 | yes | 0 | 0 | 0 | 0 |
| `2026-08-27-fleet-drive-hardening` | no | 2 | 2 | yes | 6 | 1 | 1488 | 29 |
| `2026-08-27-fleet-orch-hardening` | no | 2 | 2 | yes | 9 | 0 | 2601 | 70 |
| `2026-08-27-fleet-shim-scoping` | no | 0 | 0 | yes | 9 | 0 | 1893 | 35 |
| `2026-08-27-fleet-vmname-entry-guard` | no | 0 | 0 | yes | 3 | 0 | 793 | 20 |
| `2026-08-27-w2-entry-slate` | no | 2 | 2 | yes | 5 | 2 | 1928 | 44 |

## Known instances

| Plan | Render | Task | Needle | Surfaced | Why |
|---|---|---|---|---|---|
| `2026-08-27-w2-entry-slate` | blast-radius | 1 | `fleet/tests/test_drive.mjs` | yes | run-14 task 1: additive `runShim` outcome shape change; the strict-equality pin lived in sibling-owned test_drive.mjs; cost one redirect round (#233) |
| `2026-08-27-w2-entry-slate` | referent | 4 | `.claude/ultrapowers/fleet-runs-2026-08-26` | yes | gitignored evidence dir named as if committed (#321 item 2) |
| `2026-08-27-w2-entry-slate` | referent | 4 | `detail.creditSpendUsd` | NO | per-run spend field labeled with a monthly baseline; the field is gone at BASE since #343, so the existence check surfaces it |

## Canonical false positives

| Fixture | blast-radius | referent |
|---|---|---|
| `wide` | 0 | 0 |
| `chained` | 0 | 0 |
| `mixed` | 0 | 0 |
| `degrade` | 0 | 0 |
| `contend` | 0 | 0 |

## Render size

- arm B adds 8703 bytes / 198 lines across 15 plan(s) (mean 580.2 bytes, 13.2 lines per plan).
- blast-radius: 32 advisory block(s) in total.
- referent: 3 advisory block(s) in total.

## Bar (#345)

- known instances surfaced: 2/3
- canonical false positives: 0 (bar: 0)
- exit-code / verdict-line parity: all rows equal

## Raw advisories (arm B)

### `chained`

```text
(none)
```

### `contend`

```text
(none)
```

### `contend-big`

```text
(none)
```

### `contend-prod`

```text
(none)
```

### `degrade`

```text
(none)
```

### `flawed`

```text
(none)
```

### `flawed-routing`

```text
(none)
```

### `mixed`

```text
(none)
```

### `webapp`

```text
(none)
```

### `wide`

```text
(none)
```

### `2026-08-27-fleet-drive-hardening`

```text
ADVISORY blast-radius: Task 1 Produces `deliverAndClose` — 3 file(s) at BASE outside Task 1's Files mention it:
  - fleet/shim.mjs
  - fleet/tests/test_drive.mjs
  - fleet/tests/test_shim_transport.mjs
ADVISORY blast-radius: Task 2 Produces `CREDITS_REFUSAL_NOTE` — 1 file(s) at BASE outside Task 2's Files mention it:
  - tests/test_check_renders.py
ADVISORY blast-radius: Task 3 Produces `driveOne` — 6 file(s) at BASE outside Task 3's Files mention it:
  - fleet/drive-one.mjs
  - fleet/provision.mjs
  - fleet/tests/_drive_helpers.mjs
  - fleet/tests/test_drive_lifecycle.mjs
  - fleet/tests/test_drive_one.mjs
  - tests/test_check_renders.py
ADVISORY blast-radius: Task 3 Produces `parkedPublishWaitMs` — 2 file(s) at BASE outside Task 3's Files mention it:
  - fleet/tests/_drive_helpers.mjs
  - fleet/tests/test_drive_lifecycle.mjs
ADVISORY blast-radius: Task 4 Produces `driveOne` — 6 file(s) at BASE outside Task 4's Files mention it:
  - fleet/drive-one.mjs
  - fleet/provision.mjs
  - fleet/tests/_drive_helpers.mjs
  - fleet/tests/test_drive_lifecycle.mjs
  - fleet/tests/test_drive_one.mjs
  - tests/test_check_renders.py
ADVISORY blast-radius: Task 4 Produces `allowUnfitPlan` — 3 file(s) at BASE outside Task 4's Files mention it:
  - fleet/drive-one.mjs
  - fleet/tests/test_drive_lifecycle.mjs
  - fleet/tests/test_drive_one.mjs
ADVISORY referent: Task 4 names `docs/unfit-plan.md` — not at BASE, not in Task 4's Files, not Created by a task it Depends-on
```

### `2026-08-27-fleet-orch-hardening`

```text
ADVISORY blast-radius: Task 2 Produces `provisionRun` — 5 file(s) at BASE outside Task 2's Files mention it:
  - fleet/drive.mjs
  - fleet/shim-main.mjs
  - fleet/tests/_drive_helpers.mjs
  - fleet/tests/test_drive_lifecycle.mjs
  - tests/test_check_renders.py
ADVISORY blast-radius: Task 2 Produces `runId` — 29 file(s) at BASE outside Task 2's Files mention it:
  - fleet/drive-one.mjs
  - fleet/drive.mjs
  - fleet/shim-main.mjs
  - fleet/shim.mjs
  - fleet/store.mjs
  - fleet/tests/_drive_helpers.mjs
  - fleet/tests/test_drive.mjs
  - fleet/tests/test_drive_lifecycle.mjs
  … +21 more
ADVISORY blast-radius: Task 2 Produces `wsUrl` — 10 file(s) at BASE outside Task 2's Files mention it:
  - fleet/drive.mjs
  - fleet/shim-main.mjs
  - fleet/shim.mjs
  - fleet/tests/_drive_helpers.mjs
  - fleet/tests/test_drive.mjs
  - fleet/tests/test_drive_lifecycle.mjs
  - fleet/tests/test_shim.mjs
  - fleet/tests/test_shim_main_publish.mjs
  … +2 more
ADVISORY blast-radius: Task 2 Produces `planPath` — 25 file(s) at BASE outside Task 2's Files mention it:
  - evals/ab_runner.py
  - evals/run_frontier_cell.py
  - fleet/drive-one.mjs
  - fleet/drive.mjs
  - fleet/shim-main.mjs
  - fleet/store.mjs
  - fleet/tests/_drive_helpers.mjs
  - fleet/tests/test_drive.mjs
  … +17 more
ADVISORY blast-radius: Task 2 Produces `ttlMs` — 18 file(s) at BASE outside Task 2's Files mention it:
  - fleet/drive-one.mjs
  - fleet/drive.mjs
  - fleet/orchestrator.mjs
  - fleet/shim-main.mjs
  - fleet/shim.mjs
  - fleet/store.mjs
  - fleet/tests/_drive_helpers.mjs
  - fleet/tests/test_drive.mjs
  … +10 more
ADVISORY blast-radius: Task 3 Produces `engineSha` — 2 file(s) at BASE outside Task 3's Files mention it:
  - fleet/shim-main.mjs
  - fleet/tests/test_drive_lifecycle.mjs
ADVISORY blast-radius: Task 3 Produces `pluginVersion` — 2 file(s) at BASE outside Task 3's Files mention it:
  - fleet/shim-main.mjs
  - fleet/tests/test_drive_lifecycle.mjs
ADVISORY blast-radius: Task 4 Produces `driveOne` — 6 file(s) at BASE outside Task 4's Files mention it:
  - fleet/drive-one.mjs
  - fleet/provision.mjs
  - fleet/tests/_drive_helpers.mjs
  - fleet/tests/test_drive_lifecycle.mjs
  - fleet/tests/test_drive_one.mjs
  - tests/test_check_renders.py
ADVISORY blast-radius: Task 4 Produces `runId` — 29 file(s) at BASE outside Task 4's Files mention it:
  - fleet/drive-one.mjs
  - fleet/provision.mjs
  - fleet/shim-main.mjs
  - fleet/shim.mjs
  - fleet/store.mjs
  - fleet/tests/_drive_helpers.mjs
  - fleet/tests/test_drive_lifecycle.mjs
  - fleet/tests/test_drive_one.mjs
  … +21 more
```

### `2026-08-27-fleet-shim-scoping`

```text
ADVISORY blast-radius: Task 1 Produces `runArtifactDirs` — 1 file(s) at BASE outside Task 1's Files mention it:
  - fleet/tests/test_drive_lifecycle.mjs
ADVISORY blast-radius: Task 1 Produces `findReceiptFiles` — 1 file(s) at BASE outside Task 1's Files mention it:
  - fleet/tests/test_drive_lifecycle.mjs
ADVISORY blast-radius: Task 1 Produces `findGateReceiptFile` — 1 file(s) at BASE outside Task 1's Files mention it:
  - fleet/tests/test_drive_lifecycle.mjs
ADVISORY blast-radius: Task 1 Produces `findRunReportFile` — 1 file(s) at BASE outside Task 1's Files mention it:
  - fleet/tests/test_drive_lifecycle.mjs
ADVISORY blast-radius: Task 1 Produces `invokeEngineRun` — 2 file(s) at BASE outside Task 1's Files mention it:
  - fleet/tests/test_drive_lifecycle.mjs
  - fleet/tests/test_shim_main_publish.mjs
ADVISORY blast-radius: Task 1 Produces `applyRunReceipts` — 1 file(s) at BASE outside Task 1's Files mention it:
  - fleet/tests/test_drive.mjs
ADVISORY blast-radius: Task 1 Produces `runShim` — 9 file(s) at BASE outside Task 1's Files mention it:
  - fleet/drive.mjs
  - fleet/shim.mjs
  - fleet/tests/_drive_helpers.mjs
  - fleet/tests/test_drive.mjs
  - fleet/tests/test_shim.mjs
  - fleet/tests/test_shim_main_publish.mjs
  - fleet/tests/test_shim_transport.mjs
  - skills/ultrapowers/scripts/compile_plan.py
  … +1 more
ADVISORY blast-radius: Task 1 Produces `invokeRun` — 8 file(s) at BASE outside Task 1's Files mention it:
  - fleet/shim.mjs
  - fleet/tests/_drive_helpers.mjs
  - fleet/tests/test_drive.mjs
  - fleet/tests/test_drive_lifecycle.mjs
  - fleet/tests/test_shim.mjs
  - fleet/tests/test_shim_main_publish.mjs
  - fleet/tests/test_shim_main_tokens.mjs
  - fleet/tests/test_shim_transport.mjs
ADVISORY blast-radius: Task 3 Produces `readSessionTokens` — 1 file(s) at BASE outside Task 3's Files mention it:
  - fleet/tests/test_drive.mjs
```

### `2026-08-27-fleet-vmname-entry-guard`

```text
ADVISORY blast-radius: Task 1 Produces `driveOne` — 6 file(s) at BASE outside Task 1's Files mention it:
  - fleet/drive-one.mjs
  - fleet/provision.mjs
  - fleet/tests/_drive_helpers.mjs
  - fleet/tests/test_drive_lifecycle.mjs
  - fleet/tests/test_drive_one.mjs
  - tests/test_check_renders.py
ADVISORY blast-radius: Task 1 Produces `runId` — 29 file(s) at BASE outside Task 1's Files mention it:
  - fleet/drive-one.mjs
  - fleet/provision.mjs
  - fleet/shim-main.mjs
  - fleet/shim.mjs
  - fleet/store.mjs
  - fleet/tests/_drive_helpers.mjs
  - fleet/tests/test_drive_lifecycle.mjs
  - fleet/tests/test_drive_one.mjs
  … +21 more
ADVISORY blast-radius: Task 1 Produces `isSafeVmName` — 1 file(s) at BASE outside Task 1's Files mention it:
  - fleet/tests/test_drive_lifecycle.mjs
```

### `2026-08-27-w2-entry-slate`

```text
ADVISORY blast-radius: Task 1 Produces `runShim` — 7 file(s) at BASE outside Task 1's Files mention it:
  - fleet/drive.mjs
  - fleet/tests/_drive_helpers.mjs
  - fleet/tests/test_drive.mjs
  - fleet/tests/test_shim.mjs
  - fleet/tests/test_shim_main_publish.mjs
  - skills/ultrapowers/scripts/compile_plan.py
  - tests/test_check_renders.py
ADVISORY blast-radius: Task 2 Produces `driveOne` — 6 file(s) at BASE outside Task 2's Files mention it:
  - fleet/drive-one.mjs
  - fleet/provision.mjs
  - fleet/tests/_drive_helpers.mjs
  - fleet/tests/test_drive_lifecycle.mjs
  - fleet/tests/test_drive_one.mjs
  - tests/test_check_renders.py
ADVISORY blast-radius: Task 2 Produces `ttlMs` — 18 file(s) at BASE outside Task 2's Files mention it:
  - fleet/drive-one.mjs
  - fleet/orchestrator.mjs
  - fleet/provision.mjs
  - fleet/shim-main.mjs
  - fleet/shim.mjs
  - fleet/store.mjs
  - fleet/tests/_drive_helpers.mjs
  - fleet/tests/test_drive_lifecycle.mjs
  … +10 more
ADVISORY blast-radius: Task 2 Produces `capTokens` — 8 file(s) at BASE outside Task 2's Files mention it:
  - fleet/drive-one.mjs
  - fleet/orchestrator.mjs
  - fleet/store.mjs
  - fleet/tests/test_drive_lifecycle.mjs
  - fleet/tests/test_drive_one.mjs
  - fleet/tests/test_orchestrator.mjs
  - fleet/tests/test_shim_main_publish.mjs
  - fleet/tests/test_shim_main_tokens.mjs
ADVISORY blast-radius: Task 3 Produces `driveOne` — 6 file(s) at BASE outside Task 3's Files mention it:
  - fleet/drive-one.mjs
  - fleet/provision.mjs
  - fleet/tests/_drive_helpers.mjs
  - fleet/tests/test_drive_lifecycle.mjs
  - fleet/tests/test_drive_one.mjs
  - tests/test_check_renders.py
ADVISORY referent: Task 4 names `credits.json` — not at BASE, not in Task 4's Files, not Created by a task it Depends-on
ADVISORY referent: Task 4 names `.claude/ultrapowers/fleet-runs-2026-08-26` — not at BASE, not in Task 4's Files, not Created by a task it Depends-on
```

