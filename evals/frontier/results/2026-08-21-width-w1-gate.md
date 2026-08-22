# Width W1 gate — first live remote run (§W1d read) — 2026-08-21/22

**Status: COMPLETE — O1 PASSED on real infrastructure.** run-6 gate read is a
clean §W1d green: `o1: true`, receipts resolved on the real fetched integration
branch, lease continuous, version stamped. Spec:
`docs/superpowers/specs/2026-08-21-width-program.md` §W1a–§W1d; plan Task 10
(`docs/superpowers/plans/2026-08-21-width-w1-remote-run.md`); procedure
`fleet/RUNBOOK.md`. Tracking #189; residuals #190.

Six runs were driven (calibration payloads on branch `claw/fleet-w1-calibration-plan`).
run-6's read is the O1 artifact; runs 1–5 each surfaced a real setup/authoring
defect (all diagnosed below), none an infrastructure fault of the W1 mechanism.

## The §W1d gate read (run-6) — O1 GREEN

`gate-read-run-6.json` (byte-for-byte, machine-written by `driveOne`):

```json
{
  "o1": true,
  "receiptsResolvable": true,
  "leaseContinuity": true,
  "versionStamp": true,
  "spendObservational": { "reported": null, "ledger": 0 }
}
```

`gate-read-run-6.detail.json`: `status: gate-green`, `elapsedMs: 1419318` (~23.7 min),
`convergedAway: []`, `pages: []`, `errors: []`, `epochs: [1]`, and the receipt

```json
{ "rowId": "run-6:gate", "sha": "e0bce517b061a6620052b865b4b4f1abf4d6cca3",
  "path": "fleet-receipts/run-6/gate-receipt.json", "verdict": "PASS",
  "exists": true, "reachable": true, "dereferenced": true, "resolved": true }
```

| Field | §W1d question | run-6 |
|---|---|---|
| `o1` | provision → claim → run → gate-green → receipts, zero store-caused failures | **true** |
| `receiptsResolvable` | every receipt resolves at its sha on the fetched sandbox branch (exists / reachable / dereferenced) | **true** — all three legs on the real `git fetch` of `ultra/integration-20260822052…` |
| `leaseContinuity` | lease renewed across the whole run, no false expiry | **true** — single epoch `[1]` across ~24 min |
| `versionStamp` | run row stamped with `pluginVersion` + `engineSha` | **true** |
| `spendObservational` | run report tokens vs. shim ledger sum | `{reported: null, ledger: 0}` — **inert, see Constants** |

The run drove the full path end to end, including the legs no earlier run reached:
the orchestrator's real SSH `git fetch` of the sandbox's integration branch, then
`git cat-file -e <sha>` (exists), `git merge-base --is-ancestor <sha> FETCH_HEAD`
(reachable), and `git cat-file -e <sha>:<path>` (tree dereference) on the committed
`fleet-receipts/run-6/gate-receipt.json`. Content authority is git; the store carried
only the pointer. W1 is proven on real `exe.dev` infrastructure.

## Infrastructure as built (2026-08-21/22 UTC)

| Piece | Value |
|---|---|
| Golden VM `fleet-golden` | exeuntu, 8 vCPU / 16 GB (`nproc` 8), node v24.19.0, pytest 9.1.1, Claude Code 2.1.238, plugin `ultrapowers@ultrapowers` 0.2.17 (user scope), **no superpowers**, repo clone `/home/exedev/repo`, `fleet/node_modules` installed, `~/.claude/settings.json` = `{permissions.defaultMode: bypassPermissions, env: {ANTHROPIC_BASE_URL: https://llm.int.exe.xyz, ANTHROPIC_API_KEY: exe-gateway, CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: 0}, enabledPlugins: {ultrapowers@ultrapowers: true}}`, git identity `fleet@localhost`, tag `fleet`. `git status` clean; `.claude/workflows/{probe,waves}.js` byte-identical to the plugin cache; fresh-clone first-session probe returns `{"ok":true}`. |
| Orchestrator VM `fleet-orchestrator` | 2 vCPU / 4 GB, node v24, repo clone at the plan branch, own ed25519 key registered `ssh-key add --tag=fleet` (reaches only `fleet`-tagged VMs; lobby `ls/cp/rm` scoped; untagged VMs denied). |
| LLM check (§W1a zero-secrets) | `claude -p "reply with exactly: OK"` on `fleet-golden` with **no** env on the command line → `OK`. Model access rides the exe.dev LLM integration; no key on the VM. |
| Preflight | `preflight({orchVm, probeVm})` → `{"sshFetch":true,"httpsFallback":false,"verdict":"ssh"}`. Probe `cp`/`rm` from the orchestrator under its tagged key. **verdict `ssh`** — the run rode direct SSH; no HTTPS fallback needed. |
| Transport | exe.dev VMs share no private network (docs: *"VMs … are isolated"*); `<vm>.exe.xyz:<port>` hits the HTTPS edge (302 → login). Sandbox→orchestrator ws rode an **SSH reverse tunnel** the driver opened before the shim started (`ssh -fN -R 8180:127.0.0.1:8180 fleet-<runId>.exe.xyz`), so `wsUrl` stayed `driveOne`'s default `ws://127.0.0.1:8180/fleet`, true on both ends. Orchestrator-initiated both directions, per §W1b. |

## Run log (each a diagnosed defect; W1 mechanism never at fault)

| Run | Plan | Outcome | Root cause (class) |
|---|---|---|---|
| run-1 | 3-task hardening | parked 261s | Step-4a probe `Workflow not found` — golden's `.claude/workflows/waves.js` not byte-identical to plugin cache, so the session_start hook re-copied it after the registry snapshot on every clone's first session. **Golden-warm defect.** Fix: warm the golden in `cwd=/home/exedev/repo` until the hook is a `cmp` no-op; verify a first-session probe on a fresh clone. |
| run-2 | 3-task hardening | parked 870s | Wave launched, but headless `claude -p` waits ≤600s for background tasks then terminates the Workflow mid-wave. **Harness-timeout defect.** Fix: `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0` in golden settings.json + `/etc/environment`. |
| run-3 | 3-task hardening | parked 6s | `Unknown command: /ultrapowers`. My between-runs heredoc rewrite of `settings.json` dropped the `enabledPlugins` key that `plugin install --scope user` had written → plugin disabled. **Operator-error.** Fix: settings.json must carry `{permissions, env, enabledPlugins}` together; verify `plugin list` enabled on a fresh clone. |
| run-4 | 3-task hardening | parked ~35min, **full pipeline** | Provision→claim→wave(3)→reviews→merge(`adb88d4`)→gate all ran; receipt published (`002fa210…`) with real sha; lease + stamp true. `o1:false` only because gate verdict = **NEEDS_ACK**: a single `deferred:external` ack from my plan's self-referential acceptance line (declared its own held-out verification to be the live run). **Plan-authoring defect.** Fixed → run-5. |
| run-5 | 3-task hardening (acceptance de-self-referenced) | parked ~42min | Again NEEDS_ACK, but a **different** `deferred:external` ack: Task 3 tests the shim's real-golden-image behavior, verifiable only under real infra, so the engine's completeness critic honestly defers it. Any plan that tests the fleet's own real-infra behavior emits such an ack. **Intrinsic to the payload**, not a defect. |
| **run-6** | **1-task self-contained smoke** (`fleet/runid.mjs`, pure) | **gate-green ~24min** | Zero deferrable claims → gate verdict **PASS** → shim greens → receipt resolves → **`o1: true`**. |
| **run-7** | same smoke plan, on the #195 token-source fix | **gate-green ~23min** | O1-green **and** first real spend read: `spendObservational {reported: 44571, ledger: 44571}` (was `null/0` on runs 1–6). Proves the token source live; recorded as the floor baseline below. |

The shim greens only on a bare gate verdict of `PASS` (`readGateGreen` in
`shim-main.mjs`); `NEEDS_ACK` maps to park. This is the load-bearing lesson from
runs 4–5: a headless run's O1 requires a plan with **no** honest ack — a fully
self-contained payload. Recorded as a W1d finding (below).

## Constants set at this gate — DEFERRED TO W2; run-7 recorded as the FLOOR baseline

### The measurement now works (was blocked on #190 item 1)

Runs 1–6 all read `spendObservational.reported: null, ledger: 0` — the engine's
`report.json` carries no token field, so the spend hard-cap was inert (#190
item 1, confirmed empirically). **That is now fixed** (#195, merged `9d1929b`):
the shim launches the engine with a fixed `--session-id` and sums `output_tokens`
across the run's transcript **and its subagents'** (`readSessionTokens`). Proven
live on **run-7** (same self-contained smoke plan as run-6, so also O1-green):

```json
{ "o1": true, "receiptsResolvable": true, "leaseContinuity": true, "versionStamp": true,
  "spendObservational": { "reported": 44571, "ledger": 44571 } }
```

`reported == ledger` exactly, and the count was observed rising monotonically
through the run (5,679 → 13,255 → 26,137 → 44,571) — the cumulative shape the
delta sampler requires. The spend cap is no longer inert: spend rows land and sum.

### But the constants are NOT set from run-7 — deliberately (operator call 2026-08-22)

run-7's 44,571 output tokens is a **FLOOR reading, not a typical run.** The smoke
plan is one trivial pure function + its test, sized to gate a clean PASS — so its
cost is essentially the engine's fixed per-run overhead (preflight, compile, knob
validation, one micro-task, review, merge, gate) with almost no implementation on
top. Anchoring a spend cap near this floor would false-park every real
(3–8 task) plan.

Two of the three constants are, per the spec, **defined** to need more than one run:

| Constant | Why not from run-7 | Where it belongs |
|---|---|---|
| **Anomaly multiple** (burn-rate page) | Spec §W1c: "activates only once a trailing window of **≥5 runs** exists (W2 at the earliest)." | **W2** |
| **Spend-vs-report tolerance** | run-7 gives one data point of **zero** drift (`reported == ledger`), and both come from reading the same transcripts; a tolerance band describes drift across many runs. Spec §W1d: pass/fail "from W2 on." | **W2** |
| **Cap defaults** (per-run + docket) | Want a *typical-with-headroom* figure; a single floor-cost run gives neither the typical nor the spread. | **W2** (grounded from a representative multi-run sample) |

**Decision:** record run-7 as the floor baseline; **keep the current placeholder
per-run cap of `2,000,000` output tokens** — ~45× the floor, high enough never to
false-trip a real job, low enough to still catch a genuine runaway, and now
*functional* rather than inert. Set the three constants in **W2**, from ≥5 runs on
representative plans (per-run cap ≈ the sample's 90th percentile + headroom). Not
inventing them from a degenerate n=1.

- **Floor baseline (run-7):** 44,571 output tokens for a minimal 1-task plan.
- **Placeholder per-run cap (unchanged):** 2,000,000 output tokens (`driveOne` default; orchestrator `budgets`).

## Findings (candidates for issues)

1. **Spend source (#190 item 1) — confirmed blocking for constants.** Until
   `report.json` (or another shim-reachable artifact) carries a token total,
   `spendObservational.reported` is `null`, the ledger is `0`, the hard-cap never
   fires, and cap/anomaly/tolerance constants cannot be set. This is now the gating
   item for W1c operationalization, not just a residual.
2. **NEEDS_ACK never greens the shim.** `readGateGreen` requires verdict `PASS`;
   any honest `deferred:external`/ack-worthy plan parks. A headless O1 therefore
   needs a self-contained payload. Consider whether the W1 shim should treat
   `NEEDS_ACK` as a valid terminal that still publishes and counts toward O1 (the
   ack is a human decision above the run, like the fold) — or whether the docket
   sweep should only feed the fleet plans that gate clean.
3. **Run-wide `testCmd` redundancy (wall-clock).** The shim spawns
   `claude -p /ultrapowers <plan>` with no `--test-cmd`, so the engine auto-derives
   `python3 -m pytest` (whole 1090-test suite, ~145s) and every implementer, the
   reviewer, the merge, and the gate all run it. For a fleet-only plan the relevant
   tests are the ~7 in `tests/test_fleet_suite.py`. Scope each implementer's local
   test-cmd to its `Files:` dirs and reserve the whole-repo suite for the gate
   (compiler already supports per-task `testCmd`); also shrinks the fixed-port
   (8151–8153) `EADDRINUSE` window the engine's own preflight flags.
4. **`fleet/RUNBOOK.md` gaps** (all cost a parked run before the golden was right):
   setup-script did not install node (installed by hand); `claude plugin install
   ultrapowers` is not a real command (`marketplace add` + `install …@… --scope
   user`); placeholder clone URL; golden needs pytest + git identity + settings.json
   {env, bypassPermissions, **enabledPlugins**} + `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0`;
   golden must be **warmed** (workflows byte-identical) and **verified on a fresh
   clone** (first-session probe `{"ok":true}`, `plugin list` enabled, clean
   `git status`); orchestrator needs an account SSH credential (`ssh-key add
   --tag=fleet` works and scopes reach); VM→VM ws needs an SSH reverse tunnel
   (`provision.mjs` has no tunnel step — it lived in the driver's exec wrapper);
   `driveOne`'s `wsHost` default `127.0.0.1` only works with the tunnel + orchestrator
   co-location; **evidence-before-teardown**: `driveOne` destroys the sandbox before
   reading any log, so shim.log/transcripts die with the VM — the driver was patched
   to `tar` them back before `rm` (belongs in `drive.mjs`/RUNBOOK).

## Reproduction artifacts

- run-6 read + detail: on `fleet-orchestrator:/home/exedev/fleet-orch-live/gate-read-run-6.{json,detail.json}`.
- Pulled sandbox evidence (shim.log, engine + agent transcripts, run dirs) for runs 2/3/4/5/6:
  `fleet-orchestrator:/home/exedev/fleet-run-logs/fleet-<runId>-*/sandbox-logs.tgz` (evidence-before-teardown pull).
- Golden + orchestrator VMs left running for W2; all `fleet-run-*` sandboxes destroyed.
