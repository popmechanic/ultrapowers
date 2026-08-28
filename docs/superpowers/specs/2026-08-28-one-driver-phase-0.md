# One Driver — Phase 0: the encapsulation-only cut (#371)

**Parent:** map #366, Amendment 2. **Inputs:** `2026-08-28-one-driver-design-inputs.md`
(the frozen ledger; every deletion below cites its row). **Engine loop untouched:**
`harnesses/waves.js`, `kernel/`, `fold_wave.py`, `compile_plan.py`, `run_acceptance.sh`'s
`--suite-gate` half, and every `gate_check.py` check except the lock check (row 1) are
not edited by this phase. **Prerequisites:** #368 merged (runs A/B publish through it);
#373 merged (run C executes the cut engine from its own checkout).

## What Phase 0 is

Half 1 of the eureka on the current engine: every `/ultrapowers` run is a fleet run
(one `claude -p` session per exe.dev sandbox, the mess disposable), so the guards that
only ever protected a long-lived shared laptop checkout are deleted — with the ledger
row that licenses each — and nothing else changes. The Workflow tool still runs
`waves.js` inside the sandbox; the port (Half 2) is the next map step, after the #243
grilling.

## Bar (pre-registered in #371; numbers go into the release commit)

| measure | today | bar |
|---|---|---|
| `skills/ultrapowers/SKILL.md` | 3,129 words | ≤ 1,000 words |
| entries under `skills/ultrapowers/scripts/` | 26 | ≤ 16 (this spec: 13) |
| guards deleted, each with a licensing ledger row | 0 | ≥ 6 (this spec: 11) |
| fixture-corpus gate parity | `compile_plan.py --check` over every `evals/fixtures/*/plan.md` + `ab_runner.py`'s unit-tested assembly/harvest half | unchanged (the suite pins both; the live-drive/exam half is a local substrate and is dead under Amendment 1 — see row 7) |
| one fleet run green on the cut engine, all five §W1d legs | — | run C, on #373's engine-from-checkout, BEFORE the release; posted on #189 with the PR number |
| its PR opened by the orchestrator (#368) | — | laptop never fetches the branch |

## The one mechanism this phase adds (a guard swapped, not added)

The shim sets **`ULTRAPOWERS_FLEET_RUN=<runId>`** in the engine process's environment:
`fleet/shim-main.mjs` `spawnEngineProcess` spawns with `{ ...process.env, ULTRAPOWERS_FLEET_RUN }`
(today it inherits the env untouched), pinned by a new scenario in
`fleet/tests/test_shim_main_gate.mjs`. Two consumers:

1. `ultra_run.py` gains a first stage **`fleet-run`** that fails closed when the
   variable is unset ("`/ultrapowers` runs only inside a fleet sandbox — launch
   `drive-one` on the orchestrator"). It **replaces** the `launch-checkout` (#129) stage,
   itself a shared-laptop guard (row 9). A laptop LLM that ignores the prose cannot run
   the engine locally.
2. `SKILL.md` opens with the rule: *variable set → you are the engine session, run
   §Engine; unset → you are the client, run §Client.*

- **§Client (laptop):** commit the plan on the ref you will pass as `--base-ref`
  (default `HEAD`, pushed — the fitness preflight reads `<baseRef>:<plan>`), launch
  `node fleet/drive-one.mjs <plan> run-<N>` on the orchestrator (RUNBOOK §Live W1 run),
  watch the drive log / store, and read the receipt in the PR the orchestrator opens
  (green → PR; parked → draft PR, ack by marking ready). Nothing runs locally; there is
  no local fallback (Amendment 1) — Step 6's sequential fallback is deleted (row 10).
- **§Engine (sandbox):** the surviving steps, in order — `ultra_run.py` (`fleet-run`,
  `git-repo`, `worktree-probe`, `superpowers-compat`, `compile`, `test-command`,
  `install`, `dirty-baseline`, `base-branch`), judge-and-fill the knobs, render, launch
  `ultrapowers-run` by `meta.name`, `finalize_report.py`, `ultra_gate.py`, then the
  **two-move rule** on the verdict: `PASS` → approve; `NEEDS_ACK` → approve iff every
  ack is `deferredVerification` with reason `runtime`/`external`, writing
  `run-<stamp>/standing-approval.json` `{grantedAt, instruction, ackList}` first (the
  launch directive is the instruction); anything else → leave the gate receipt as the
  terminal artifact and end. Approve = `ultra_gate.py --approve --stamp <stamp>`
  (checkout + re-verify tests) **and save its JSON verbatim to
  `run-<stamp>/approve-receipt.json`** — `readGateGreen` (shim) greens only on that
  receipt with a matching stamp. A sealed-disposition plan is `BLOCKED` at the gate
  ("sealed acceptance is not administered — Phase 0 row 7").

## Deletion ledger for this phase (what dies → the design-inputs row that licenses it)

| # | dies | licensed by |
|---|---|---|
| 1 | `run_lock.sh`, `RUN_LOCK`, `ultra_run.py`'s `lock` stage, `ultra_gate.py`'s lock release, **`gate_check.py`'s `lock` check and its `lock` path in the receipt** (the one periphery edit; a deletion, not a check change), the shim's `RUN_LOCK` read in `readGateGreen` (+ `test_shim_main_gate.mjs` scenarios 12–13), CLAUDE.md "serialize runs"/#134 | *two LLM sessions sharing one checkout* → one sandbox per run |
| 2 | `sweep_worktrees.sh`, `wf-runs.json`, `record_wf_run.py` (ultradocket; its `stamp` mode's `.claude/ultrapowers/receipts/` has one reader, `harvest_runs.py:563–575` — that read becomes an empty glob, no other consumer), `ultra_gate.py --teardown` + sweep set, `ultra_run.py`'s `worktree-audit` stage, `wf_<stamp>`/`--all` choreography | *git worktrees registered in the primary `.git`* → the sandbox is `rm`'d |
| 3 | `hygiene_check.sh`, `residual_manifest.py`, the resume-gate manifest step, `finishing-notes.md` §Residual manifest | *close-of-run drift on a shared checkout* → nothing persists |
| 4 | `salvage_args.py`, `redirect_args.py`, the Salvage/Redirect lanes, round-artifact rotation, `findings.json`; `report-format.md`'s Salvage/Redirect clauses | *repairing a run in place* → a redirect is a new run with a narrower plan; a park re-drives from `parkedPublish` |
| 5 | Step 4a½, `harnesses/probe.js` + `probe.harness.json`, `ultra_run.py`'s `PROBE` + `engine-skew` stages, `check_engine_skew.sh`, **`harness_manifest.py`** (+ `test_harness_manifest.py`; `hooks/session_start.sh` copies `waves.js` by name; `ab_runner.seed_workflows` copies that one file; `test_harness_registry` keeps its collision pin by reading `waves.js`'s `meta.name` directly), `ab_runner.py`'s `probe_workflow` | *the registry snapshot at session start* → a fresh sandbox session's SessionStart hook installs before the snapshot; a launch that still says "not found" fails loudly (no receipt → red, never green). Skew: #373 makes the engine the pushed base by construction |
| 6 | Step 5's standing-grant grammar (quotable grants, sidecar-first, per-gate consumption); `report-format.md`'s Approve clause — the canonical standing-grant rendering clause — is rewritten to the two-move rule (it moves with this row, not implied) | *an LLM deciding under a legal contract* → the two-move rule, enforced by `readGateGreen` |
| 7 | `collect_seal.py`, `seal_hash.py`, `agents/seal-author.md` (no `agents` key in `plugin.json`; auto-discovered, deleting the file suffices), `ultraplan/references/seal-author-prompt.md`, ultraplan's sealing step, `run_acceptance.sh`'s `sealed` + `--baseline` modes, `ab_runner.py`'s `seal_hash` import (`suite_hash = None` fallback exists), `ultra_gate.py`'s `sealed` dispatch → `BLOCKED` | decision 3 (*cuts*). **Cost stated:** 9/11 fixture plans carry `sealed` lines; `ab_runner.install_seals` + the cell gate administered them through a *local* `claude -p` drive — a local substrate, dead under Amendment 1 regardless. The fixtures keep their lines as inert data (the compiler's vocabulary is frozen); the eval kit's execution half is deferred to the port, whose bar re-arms `ab_runner` on the driver |
| 8 | `skills/ultrapowers/viewer/`, `render_viewer.py`, `serve_viewer.py`, `swarm_watch.py`, `swarm_{layout,meso,zoom}_spec.mjs` + `audit_project_spec.mjs`, the Step 4 viewer offer, `report-format.md` item 12 | decision 3 (*cuts*) |
| 9 | `ultra_run.py` `launch-checkout` (#129) | *a long-lived laptop checkout* → replaced by `fleet-run` (above) |
| 10 | `SKILL.md` Step 6 sequential fallback (`superpowers:subagent-driven-development` as engine substitute) | Amendment 1: no local engine; superpowers never enters a sandbox |
| 11 | `ultra_run.py` `disk-headroom` (#151) and `scratch-hygiene` keep-10 prune | rows 2–3: one sandbox per run, `rm`'d — nothing accumulates |

Tests go with their scripts: `test_run_lock`, `test_sweep_worktrees`, `test_terminal_teardown`,
`test_hygiene_check`, `test_residual_manifest`, `test_salvage_args`, `test_redirect_args`,
`test_engine_skew`, `test_harness_manifest`, `test_probe`, `test_record_wf_run`,
`test_skill_wf_run_record`, `test_collect_seal`, `test_async_sealing`, `test_fixture_seals`,
`test_viewer`, `test_serve_viewer`, `test_swarm_agents`, `test_swarm_wiring`; `test_js_specs`
keeps only the three engine sims; `test_harness_registry` requires `ultrapowers-run` alone;
`test_ultra_run`, `test_ultra_gate`, `test_gate_check`, `test_run_acceptance`,
`test_session_hook` lose the cases for deleted stages; `test_skill_budget` pins
`skills/ultrapowers/SKILL.md` at **1000**.

**Not trimmed this phase (rule 1 of map #366 — no re-bake):** `references/wave-merge.md`
and `references/reviewer-prompts.md` are drift-pinned to `waves.js`; their prose still
names `sweep_worktrees.sh`, `RUN_LOCK`, `wf-runs`. That stale prose is licensed until the
port; a plan task that edits either file is off-spec. Trimmed: `finishing-notes.md`
§Residual manifest; `design-rationale.md` sections for rows 1–6, 8; `report-format.md`
Approve/Salvage/Redirect/viewer clauses; `ultradocket/SKILL.md` drain bullet + lines
239–244; `workflow-template.md` + `test_no_prompt_drift.py` stay.

**Kept, and why:** `compile_plan.py` keeps parsing `**Acceptance:** sealed …` (frozen
vocabulary). `warm_cache.sh`, `audit_run.py`, `ultra_run.py`, `finalize_report.py`,
`check_superpowers_compat.py`, `resolve_superpowers.py`, `superpowers_contract.py`: ledger
rows for the port. There is no `ultrapowers-probe` skill directory — #371's "skill" is
the saved workflow the harness registered; deleting `probe.js` removes it.

## Client-facing text (Amendment 1, decision 6)

README (§Get started + a "How it runs" paragraph), `plugin.json` / `marketplace.json`
descriptions, and the routing rubric shared by `hooks/session_start.sh` and
`ultraplan/SKILL.md` (pinned equal by `test_recommendation_rubric`) say plainly:
ultrapowers executes on an exe.dev fleet you provision (RUNBOOK); the plugin is the
client; there is no local engine. `ultradocket`'s drain bullet for the `ultrapowers`
engine becomes "commit the plan, `drive-one` it, the orchestrator's PR is the gate".
CLAUDE.md loses the self-hosting/serialize/sweep gotchas and the "sealing subsystem"
clause of the frozen-periphery rule. A pin test asserts the product sentence in README
and both manifests (a pin, not a guard).

## Delivery shape (two plans, driven B then A)

`drive-one`'s cap is **per run, total** (500k default); a two-wave plan spends the same
total as two runs, so waves do not lower it, and raising it is an operator call
(RUNBOOK). Run-18 (4 tasks) cost 313k. Phase 0 is six tasks → two plans, each within
the default cap. They are **sequential, not concurrent**: `validate_skill.py` resolves
every script path a SKILL.md names against disk, so the subtraction alone (scripts gone,
old prose) is red, and the texts alone are red on the two tests that pin the old
lock/record prose. So:

- **P0b — the two texts** (run B, first): T4 `SKILL.md` rewrite (§Client/§Engine, ≤1000
  words; rows 4, 6, 10 prose; Step 4a½/viewer offer gone) + `test_skill_budget` 1000 +
  the reference trims listed above + deleting the two prose-pin tests
  (`test_terminal_teardown`, `test_skill_wf_run_record`) + the pins that read the old
  step layout (`test_finalize_wiring`, `test_report_runbook`); T5 the shim's
  `ULTRAPOWERS_FLEET_RUN` (`engineProcessEnv`, `runId` threaded and required by
  `invokeEngineRun`) + `RUN_LOCK` read removal + scenarios 12–13; T6 client-facing text
  + rubric mirror + **ultraplan's sealing step + `seal-author-prompt.md` +
  `test_async_sealing` deletion** + ultradocket prose + CLAUDE.md + the product-sentence
  pin test. On B's branch every script still exists, so the new prose validates.
- **P0a — subtraction** (run A, on B's merged base): T1 rows 1, 2, 3, 4, 5, 9, 11 —
  `ultra_run.py`/`ultra_gate.py`/`gate_check.py` edits, all of `ab_runner.py`'s edits
  (probe removal AND the seal import, lines 42–51 are one adjacent block — a deletion
  conflict routes to the resolver, not the auto-union), `hooks/session_start.sh`'s
  install block (must ride with the `harness_manifest.py` deletion or the hook's install
  breaks between merges), `record_wf_run.py` (its `stamp` writer is inlined into
  `tests/test_harvest_runs.py`'s fixture generator, same schema); T2 row 7 (scripts,
  agent, `run_acceptance.sh` → `--suite-gate` only, `ultra_gate.py` sealed → `BLOCKED`);
  T3 row 8 (`viewer/` incl. vendored d3, three scripts, four specs, `test_js_specs`).
  Shared inside the run: `ultra_gate.py` (T1, T2 — far-apart hunks, header `Commutes`);
  `test_ultra_gate.py` (T1, T2 — far-apart hunks, undeclared, the fold composes them).

One file is touched by both plans — `hooks/session_start.sh` (B: the rubric heredoc; A:
the install block) — disjoint hunks in sequential PRs. `waves.harness.json` and
`tests/fixtures/args-probe.js` stay (the `install` stage still reads the manifest glob;
the port removes it). `ultra_run.py --validate-knobs` returns before the stage pipeline
and stays ungated (a laptop can knob-validate; it cannot launch).

Then: golden refresh is moot (#373) → **run C on the cut engine** (payload: the #362 fleet
chore plan, fleet-only, two tasks) → its gate read + orchestrator-opened PR complete
the bar → `chore(release): 0.2.26` with every number (the operator's default; `0.3.0-pre`
was offered in #371 as their call) → golden → 0.2.26.

## Rules (map #366 §Rules apply)

Trust core untouched (receipts at shas, exit-code authority, standing directive,
park-by-default, human merge on the PR). No new guard without a deletion in the same
PR. No local `/ultrapowers`, no local suite (CI + the sandbox run it). `waves.js`,
`kernel/`, `wave-merge.md`, `reviewer-prompts.md` are not edited — a plan task that needs
to is off-spec.

## Trim review

**Author's disclosure (input, not verdict).** Adds: the `ULTRAPOWERS_FLEET_RUN` branch
(env + `fleet-run` stage), a product-sentence pin, a two-run delivery practice. Removes:
rows 1–11 above.

**Reviewer (fresh context, 2026-08-28): `netConceptDelta` DOWN — 12 removed / 3 added as
drafted; 13 / 2 with the trims.** Two rule-1 leaks named (items 7, 8).

| # | trim | disposition |
|---|---|---|
| 1 | env var is the smallest correct signal, but prose-only; make `ultra_run.py` refuse fail-closed, replacing `launch-checkout` #129; name the spawn site and pin file | **adopted** — §mechanism, rows 9; `spawnEngineProcess`, `test_shim_main_gate.mjs` |
| 2 | merge into one plan, two waves; the cap rationale is false (`--cap-tokens` is a flag) | **answered** — the cap is per-run *total*, so two waves spend the same as two runs; raising it is an operator call (RUNBOOK); rationale restated. The "#360 datum" framing dropped; plan authoring then found `validate_skill.py` couples the two halves, so the runs are **sequential (B then A)**, not concurrent |
| 3 | delete `harness_manifest.py` (N=1 manifest) | **adopted** — row 5; scripts 14 → 13 |
| 4 | say what the gate does with a `sealed` plan | **adopted** — `ultra_gate.py` → `BLOCKED`, row 7 |
| 5 | fixtures' inert `sealed` lines: state the cost; bar row narrowed silently | **adopted** — cost stated in row 7; bar row 4 narrowed explicitly (local-substrate half deferred to the port) |
| 6 | release-before-validation inverts the bar; install the plugin from the sandbox's own checkout | **adopted** — verified same-version `plugin update` is a no-op (golden, 2026-08-28); filed **#373**, prerequisite for run C; bar row 5 now "before the release" |
| 7 | row 1 breaks `gate_check.py` (`run_lock.sh check`) — a periphery script the spec says is untouched | **adopted** — the edit is named in row 1 and in the header exception |
| 8 | `wave-merge.md`/`reviewer-prompts.md` name deleted scripts; trimming them re-bakes `waves.js` | **adopted** — "Not trimmed this phase" paragraph; off-spec for plan tasks |
| 9 | `launch-checkout`, `disk-headroom`, `scratch-hygiene` are unlisted shared-laptop guards | **adopted** — rows 9, 11 |
| 10 | delete Step 6 fallback, named | **adopted** — row 10 |
| 11 | keep two-move text, rows 7/8, 1000-word pin, product pin | **adopted** |

Under-specification: `approve-receipt.json` (adopted, §Engine); `warm_cache.sh` (fixed);
fleet tests named (adopted, row 1); §Client base-ref wording (adopted); `record_wf_run`
`stamp` mode reader (adopted — named in row 2); the trim file list incl.
`report-format.md`'s canonical grant clause (adopted, row 6 + "Not trimmed"); `plugin.json`
agents key (adopted, row 7); ordering #368/#373 before the runs (adopted, header).
Scope: the one expansion beyond #371's "shim: nothing else" is the env var (stated); #373
is a separate ticket, not Phase 0 scope.
